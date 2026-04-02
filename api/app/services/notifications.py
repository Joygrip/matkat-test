"""Notifications service — sending reminders and tracking.

Covers two categories of notification:

Legacy phases (role-blast, global-per-phase idempotency):
  PM_RO, FINANCE, EMPLOYEE, RO_DIRECTOR

Targeted alert phases (per-entity idempotency keyed on resource_id + recipient):
  CONFLICT_ALERT   — RO + PM when demand > supply for a resource
  MISSING_ACTUALS  — Employee when actuals are unsigned / missing
"""
import logging
import uuid
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError

from api.app.models.core import User, Holiday
from api.app.models.notifications import NotificationLog, NotificationPhase, NotificationStatus
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.services.conflict_detection import ConflictDetectionService
from api.app.services.graph_mail import GraphMailService
from api.app.services.missing_actuals import MissingActualsService
from api.app.config import get_settings

logger = logging.getLogger(__name__)


class NotificationsService:
    """Service for notification operations."""

    def __init__(
        self,
        db: Session,
        current_user: Optional[CurrentUser] = None,
        mail_service: Optional[GraphMailService] = None,
    ):
        self.db = db
        self.current_user = current_user
        self.settings = get_settings()
        # Lazy-initialised if not injected (useful for testing)
        self._mail_service = mail_service

    # ------------------------------------------------------------------
    # Deadline helpers
    # ------------------------------------------------------------------

    def calculate_deadline(self, year: int, month: int, base_day: int = 5) -> date:
        """
        Calculate the notification deadline, rolling forward if it falls on a holiday.

        Args:
            year: Target year
            month: Target month
            base_day: Base deadline day of month (default: 5th)

        Returns:
            date: Adjusted deadline date
        """
        deadline = date(year, month, base_day)
        tenant_id = self.current_user.tenant_id if self.current_user else None
        if not tenant_id:
            return deadline
        return self._shift_to_next_workday(deadline, tenant_id)

    def calculate_phase_deadline(self, phase: NotificationPhase, year: int, month: int) -> date:
        """
        Calculate the scheduled deadline for a notification phase:
        - PM_RO: 1st Friday
        - Finance: 3rd Friday
        - Employee: 4th Monday
        - RO_Director: 4th Tuesday
        """
        base_date = self._get_phase_base_date(phase, year, month)
        tenant_id = self.current_user.tenant_id if self.current_user else None
        return self._shift_to_next_workday(base_date, tenant_id)

    # ------------------------------------------------------------------
    # Preview
    # ------------------------------------------------------------------

    def get_preview(self, phase: NotificationPhase, year: int, month: int) -> Dict[str, Any]:
        """Get a preview of what notifications would be sent (no side effects)."""
        recipients = self._get_recipients_for_phase(phase)
        deadline = self.calculate_phase_deadline(phase, year, month)
        return {
            "phase": phase.value,
            "year": year,
            "month": month,
            "deadline": str(deadline),
            "recipients_count": len(recipients),
            "recipients": [
                {
                    "user_id": r.id,
                    "email": r.email,
                    "display_name": r.display_name,
                    "role": r.role,
                }
                for r in recipients
            ],
            "message_template": self._get_message_template(phase, year, month, deadline),
        }

    def get_preview_conflict_alerts(self, year: int, month: int) -> Dict[str, Any]:
        """Preview conflict alerts without writing any logs."""
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        detector = ConflictDetectionService(self.db, tenant_id)
        conflicts = detector.find_conflicts(year, month)

        items = []
        for c in conflicts:
            recipients = []
            if c.ro_recipient:
                recipients.append({"role": "Manager", "email": c.ro_recipient.email, "user_id": c.ro_recipient.id})
            for pm in c.pm_recipients:
                recipients.append({"role": "PM", "email": pm.email, "user_id": pm.id})
            items.append({
                "resource_id": c.resource_id,
                "resource_name": c.resource.display_name,
                "total_demand": c.total_demand,
                "total_supply": c.total_supply,
                "recipients": recipients,
            })

        return {
            "phase": NotificationPhase.CONFLICT_ALERT.value,
            "year": year,
            "month": month,
            "conflicts_count": len(conflicts),
            "conflicts": items,
        }

    # ------------------------------------------------------------------
    # Legacy phase notifications (role-blast, global idempotency)
    # ------------------------------------------------------------------

    def run_notifications(self, phase: NotificationPhase, year: int, month: int) -> Dict[str, Any]:
        """
        Run notifications for a phase (records log; sends via Graph if notify_mode='graph').

        Uses global run_id idempotency — same phase/period won't be duplicated.
        """
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        run_id = str(uuid.uuid4())

        # Global idempotency check for legacy phases
        existing = self.db.query(NotificationLog).filter(
            and_(
                NotificationLog.tenant_id == tenant_id,
                NotificationLog.phase == phase,
                NotificationLog.year == year,
                NotificationLog.month == month,
            )
        ).first()

        if existing:
            return {
                "status": "already_run",
                "message": "Notifications already sent for this phase and period",
                "existing_run_id": existing.run_id,
            }

        recipients = self._get_recipients_for_phase(phase)
        deadline = self.calculate_phase_deadline(phase, year, month)
        message_template = self._get_message_template(phase, year, month, deadline)

        notifications_created = []

        for recipient in recipients:
            if not recipient.email:
                continue
            ikey = self._idempotency_key(tenant_id, phase, year, month, recipient.id)
            log = NotificationLog(
                tenant_id=tenant_id,
                phase=phase,
                year=year,
                month=month,
                recipient_user_id=recipient.id,
                recipient_email=recipient.email,
                status=NotificationStatus.PENDING,
                message=message_template,
                run_id=run_id,
                idempotency_key=ikey,
            )
            try:
                self.db.add(log)
                self.db.flush()  # detect duplicate key before sending mail
            except IntegrityError:
                self.db.rollback()
                logger.info(
                    "run_notifications: duplicate skipped for %s (concurrent run)",
                    recipient.email,
                )
                continue

            if self.settings.notify_mode == "graph":
                self._dispatch_mail(log)
            else:
                log.status = NotificationStatus.SENT
                log.sent_at = datetime.utcnow()

            self.db.commit()  # commit each recipient so a sent mail is never re-sent
            notifications_created.append({
                "recipient_email": recipient.email,
                "status": log.status.value,
            })

        if self.current_user:
            log_audit(
                self.db, self.current_user,
                action="run_notifications",
                entity_type="NotificationLog",
                entity_id=run_id,
                new_values={
                    "phase": phase.value,
                    "year": year,
                    "month": month,
                    "recipients_count": len(recipients),
                }
            )

        return {
            "status": "success",
            "run_id": run_id,
            "phase": phase.value,
            "year": year,
            "month": month,
            "notifications_count": len(notifications_created),
            "notifications": notifications_created,
            "mode": self.settings.notify_mode,
        }

    # ------------------------------------------------------------------
    # Targeted alert: demand > supply conflicts
    # ------------------------------------------------------------------

    def run_conflict_alerts(self, year: int, month: int) -> Dict[str, Any]:
        """Detect demand > supply conflicts and notify affected ROs and PMs.

        Per-entity idempotent: a (phase, year, month, resource_id, recipient_user_id)
        combination that already has a SENT log is skipped.
        """
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        run_id = str(uuid.uuid4())
        phase = NotificationPhase.CONFLICT_ALERT

        detector = ConflictDetectionService(self.db, tenant_id)
        conflicts = detector.find_conflicts(year, month)

        sent_count = 0
        skipped_count = 0

        for conflict in conflicts:
            # Collect unique recipients: RO + all PMs
            recipients: List[User] = []
            if conflict.ro_recipient:
                recipients.append(conflict.ro_recipient)
            recipients.extend(conflict.pm_recipients)

            # Deduplicate by user_id (a user might be both RO and PM)
            seen_ids: set = set()
            for recipient in recipients:
                if recipient.id in seen_ids:
                    continue
                seen_ids.add(recipient.id)

                if not recipient.email:
                    continue

                existing = self._get_existing_log(
                    phase, year, month, conflict.resource_id, recipient.id
                )
                if existing is not None:
                    if existing.status == NotificationStatus.SENT:
                        skipped_count += 1
                        continue
                    if existing.status == NotificationStatus.PENDING:
                        skipped_count += 1
                        continue
                    # FAILED: retry if under the limit
                    if existing.retry_count >= existing.max_retries:
                        skipped_count += 1
                        continue
                    existing.status = NotificationStatus.PENDING
                    existing.retry_count += 1
                    existing.error = None
                    log = existing
                else:
                    ikey = self._idempotency_key(
                        tenant_id, phase, year, month, recipient.id, conflict.resource_id
                    )
                    message = self._conflict_message(conflict, year, month)
                    log = self._create_entity_log(
                        phase=phase,
                        year=year,
                        month=month,
                        run_id=run_id,
                        recipient_user_id=recipient.id,
                        recipient_email=recipient.email,
                        resource_id=conflict.resource_id,
                        message=message,
                        idempotency_key=ikey,
                    )
                    try:
                        self.db.add(log)
                        self.db.flush()
                    except IntegrityError:
                        self.db.rollback()
                        logger.info(
                            "run_conflict_alerts: duplicate skipped for %s (concurrent run)",
                            recipient.email,
                        )
                        skipped_count += 1
                        continue

                if self.settings.notify_mode == "graph":
                    self._dispatch_mail(log)
                else:
                    log.status = NotificationStatus.SENT
                    log.sent_at = datetime.utcnow()

                self.db.commit()
                sent_count += 1

        if self.current_user:
            log_audit(
                self.db, self.current_user,
                action="run_conflict_alerts",
                entity_type="NotificationLog",
                entity_id=run_id,
                new_values={
                    "phase": phase.value,
                    "year": year,
                    "month": month,
                    "conflicts": len(conflicts),
                    "sent": sent_count,
                    "skipped": skipped_count,
                }
            )

        logger.info(
            "run_conflict_alerts: year=%d month=%d sent=%d skipped=%d (tenant=%s)",
            year, month, sent_count, skipped_count, tenant_id,
        )

        return {
            "run_id": run_id,
            "phase": phase.value,
            "year": year,
            "month": month,
            "conflicts": len(conflicts),
            "sent": sent_count,
            "skipped": skipped_count,
            "mode": self.settings.notify_mode,
        }

    # ------------------------------------------------------------------
    # Targeted alert: missing actuals
    # ------------------------------------------------------------------

    def run_missing_actuals_alerts(self, year: int, month: int) -> Dict[str, Any]:
        """Find employees with unsigned/absent actuals and send reminders.

        Per-entity idempotent: a (phase, year, month, resource_id, recipient_user_id)
        combination that already has a SENT log is skipped.
        """
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        run_id = str(uuid.uuid4())
        phase = NotificationPhase.MISSING_ACTUALS

        detector = MissingActualsService(self.db, tenant_id)
        missing = detector.find_missing(year, month)

        sent_count = 0
        skipped_count = 0

        for item in missing:
            recipient = item.recipient
            if not recipient.email:
                continue

            existing = self._get_existing_log(
                phase, year, month, item.resource_id, recipient.id
            )
            if existing is not None:
                if existing.status == NotificationStatus.SENT:
                    skipped_count += 1
                    continue
                if existing.status == NotificationStatus.PENDING:
                    skipped_count += 1
                    continue
                # FAILED: retry if under the limit
                if existing.retry_count >= existing.max_retries:
                    skipped_count += 1
                    continue
                existing.status = NotificationStatus.PENDING
                existing.retry_count += 1
                existing.error = None
                log = existing
            else:
                ikey = self._idempotency_key(
                    tenant_id, phase, year, month, recipient.id, item.resource_id
                )
                message = self._missing_actuals_message(item.resource, year, month)
                log = self._create_entity_log(
                    phase=phase,
                    year=year,
                    month=month,
                    run_id=run_id,
                    recipient_user_id=recipient.id,
                    recipient_email=recipient.email,
                    resource_id=item.resource_id,
                    message=message,
                    idempotency_key=ikey,
                )
                try:
                    self.db.add(log)
                    self.db.flush()
                except IntegrityError:
                    self.db.rollback()
                    logger.info(
                        "run_missing_actuals_alerts: duplicate skipped for %s (concurrent run)",
                        recipient.email,
                    )
                    skipped_count += 1
                    continue

            if self.settings.notify_mode == "graph":
                self._dispatch_mail(log)
            else:
                log.status = NotificationStatus.SENT
                log.sent_at = datetime.utcnow()

            self.db.commit()
            sent_count += 1

        if self.current_user:
            log_audit(
                self.db, self.current_user,
                action="run_missing_actuals_alerts",
                entity_type="NotificationLog",
                entity_id=run_id,
                new_values={
                    "phase": phase.value,
                    "year": year,
                    "month": month,
                    "missing": len(missing),
                    "sent": sent_count,
                    "skipped": skipped_count,
                }
            )

        logger.info(
            "run_missing_actuals_alerts: year=%d month=%d sent=%d skipped=%d (tenant=%s)",
            year, month, sent_count, skipped_count, tenant_id,
        )

        return {
            "run_id": run_id,
            "phase": phase.value,
            "year": year,
            "month": month,
            "missing": len(missing),
            "sent": sent_count,
            "skipped": skipped_count,
            "mode": self.settings.notify_mode,
        }

    # ------------------------------------------------------------------
    # Retry failed notifications
    # ------------------------------------------------------------------

    def retry_failed_notifications(
        self,
        phase: Optional[NotificationPhase] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Retry FAILED logs that still have attempts remaining (retry_count < max_retries).

        Each log is retried individually and committed immediately so a successful
        send is persisted even if a later send in the same batch fails.
        """
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"

        query = self.db.query(NotificationLog).filter(
            and_(
                NotificationLog.tenant_id == tenant_id,
                NotificationLog.status == NotificationStatus.FAILED,
                NotificationLog.retry_count < NotificationLog.max_retries,
            )
        )
        if phase:
            query = query.filter(NotificationLog.phase == phase)
        if year:
            query = query.filter(NotificationLog.year == year)
        if month:
            query = query.filter(NotificationLog.month == month)

        logs = query.all()
        retried = succeeded = failed_again = 0

        for log in logs:
            log.status = NotificationStatus.PENDING
            log.retry_count += 1
            log.error = None
            if self.settings.notify_mode == "graph":
                self._dispatch_mail(log)
            else:
                log.status = NotificationStatus.SENT
                log.sent_at = datetime.utcnow()
            self.db.commit()
            retried += 1
            if log.status == NotificationStatus.SENT:
                succeeded += 1
            else:
                failed_again += 1

        logger.info(
            "retry_failed_notifications: retried=%d succeeded=%d failed_again=%d (tenant=%s)",
            retried, succeeded, failed_again, tenant_id,
        )
        return {"retried": retried, "succeeded": succeeded, "failed_again": failed_again}

    # ------------------------------------------------------------------
    # Logs
    # ------------------------------------------------------------------

    def get_logs(
        self,
        phase: Optional[NotificationPhase] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
    ) -> List[NotificationLog]:
        """Get notification logs with optional filters."""
        tenant_id = self.current_user.tenant_id if self.current_user else None

        query = self.db.query(NotificationLog).filter(
            NotificationLog.tenant_id == tenant_id
        )

        if phase:
            query = query.filter(NotificationLog.phase == phase)
        if year:
            query = query.filter(NotificationLog.year == year)
        if month:
            query = query.filter(NotificationLog.month == month)

        return query.order_by(NotificationLog.created_at.desc()).all()

    # ------------------------------------------------------------------
    # Private: idempotency
    # ------------------------------------------------------------------

    def _get_existing_log(
        self,
        phase: NotificationPhase,
        year: int,
        month: int,
        resource_id: str,
        recipient_user_id: str,
    ) -> Optional[NotificationLog]:
        """Return the existing log for this (phase, period, resource, recipient), or None."""
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        return self.db.query(NotificationLog).filter(
            and_(
                NotificationLog.tenant_id == tenant_id,
                NotificationLog.phase == phase,
                NotificationLog.year == year,
                NotificationLog.month == month,
                NotificationLog.resource_id == resource_id,
                NotificationLog.recipient_user_id == recipient_user_id,
            )
        ).first()

    def _idempotency_key(
        self,
        tenant_id: str,
        phase: NotificationPhase,
        year: int,
        month: int,
        recipient_user_id: Optional[str],
        resource_id: Optional[str] = None,
    ) -> str:
        """Build the idempotency key that uniquely identifies a logical notification."""
        parts = [tenant_id, phase.value, str(year), str(month)]
        if resource_id:
            parts.append(resource_id)
        parts.append(recipient_user_id or "")
        return "|".join(parts)

    # ------------------------------------------------------------------
    # Private: mail dispatch
    # ------------------------------------------------------------------

    def _get_mail_service(self) -> GraphMailService:
        if self._mail_service is None:
            self._mail_service = GraphMailService(self.settings)
        return self._mail_service

    def _dispatch_mail(self, log: NotificationLog) -> None:
        """Send via Graph and update log.status in place (not yet committed)."""
        subject = self._subject_for_phase(log.phase)
        body_html = self._html_body(log.message or "")
        success = self._get_mail_service().send_mail(
            to_email=log.recipient_email,
            subject=subject,
            body_html=body_html,
        )
        if success:
            log.status = NotificationStatus.SENT
            log.sent_at = datetime.utcnow()
        else:
            log.status = NotificationStatus.FAILED
            log.error = "GraphMailService returned an error — see application logs"
            logger.warning(
                "Mail dispatch failed: phase=%s recipient=%s", log.phase, log.recipient_email
            )

    # ------------------------------------------------------------------
    # Private: log factory
    # ------------------------------------------------------------------

    def _create_entity_log(
        self,
        phase: NotificationPhase,
        year: int,
        month: int,
        run_id: str,
        recipient_user_id: str,
        recipient_email: str,
        resource_id: str,
        message: str,
        idempotency_key: Optional[str] = None,
    ) -> NotificationLog:
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        return NotificationLog(
            tenant_id=tenant_id,
            phase=phase,
            year=year,
            month=month,
            recipient_user_id=recipient_user_id,
            recipient_email=recipient_email,
            resource_id=resource_id,
            status=NotificationStatus.PENDING,
            message=message,
            run_id=run_id,
            idempotency_key=idempotency_key,
        )

    # ------------------------------------------------------------------
    # Private: recipient resolution (legacy phases)
    # ------------------------------------------------------------------

    def _get_recipients_for_phase(self, phase: NotificationPhase) -> List[User]:
        """Get users who should receive notifications for a legacy phase."""
        tenant_id = self.current_user.tenant_id if self.current_user else None
        if not tenant_id:
            return []

        role_map = {
            NotificationPhase.PM_RO: ["PM", "Manager"],
            NotificationPhase.FINANCE: ["Finance"],
            NotificationPhase.EMPLOYEE: ["Employee"],
            NotificationPhase.RO_DIRECTOR: ["Manager"],
        }

        roles = role_map.get(phase, [])
        if not roles:
            return []

        return self.db.query(User).filter(
            and_(
                User.tenant_id == tenant_id,
                User.role.in_(roles),
                User.is_active == True,
            )
        ).all()

    # ------------------------------------------------------------------
    # Private: deadline helpers
    # ------------------------------------------------------------------

    def _get_phase_base_date(self, phase: NotificationPhase, year: int, month: int) -> date:
        """Get the base date for the phase before holiday shifting."""
        rules = {
            NotificationPhase.PM_RO: (4, 1),       # 1st Friday
            NotificationPhase.FINANCE: (4, 3),     # 3rd Friday
            NotificationPhase.EMPLOYEE: (0, 4),    # 4th Monday
            NotificationPhase.RO_DIRECTOR: (1, 4), # 4th Tuesday
        }
        weekday, nth = rules[phase]
        return self._nth_weekday_of_month(year, month, weekday, nth)

    def _nth_weekday_of_month(self, year: int, month: int, weekday: int, nth: int) -> date:
        """Get the date for the nth weekday of the month (weekday: Monday=0)."""
        first_day = date(year, month, 1)
        offset = (weekday - first_day.weekday()) % 7
        first_occurrence = first_day + timedelta(days=offset)
        return first_occurrence + timedelta(weeks=nth - 1)

    def _shift_to_next_workday(self, base_date: date, tenant_id: Optional[str]) -> date:
        """Shift a date forward to the next weekday that is not a holiday."""
        if not tenant_id:
            return base_date

        window_start = datetime.combine(base_date, datetime.min.time())
        window_end = datetime.combine(base_date + timedelta(days=14), datetime.max.time())
        holidays = self.db.query(Holiday).filter(
            and_(
                Holiday.tenant_id == tenant_id,
                Holiday.date >= window_start,
                Holiday.date <= window_end,
            )
        ).all()
        holiday_dates = {
            h.date.date() if isinstance(h.date, datetime) else h.date
            for h in holidays
        }

        deadline = base_date
        for _ in range(14):
            if deadline.weekday() >= 5 or deadline in holiday_dates:
                deadline = deadline + timedelta(days=1)
                continue
            break

        return deadline

    # ------------------------------------------------------------------
    # Private: message templates
    # ------------------------------------------------------------------

    def _get_message_template(
        self, phase: NotificationPhase, year: int, month: int, deadline: date
    ) -> str:
        templates = {
            NotificationPhase.PM_RO: (
                f"Reminder: Please complete demand and supply planning for "
                f"{month:02d}/{year} by {deadline}."
            ),
            NotificationPhase.FINANCE: (
                f"Reminder: Planning data for {month:02d}/{year} is ready for review. "
                f"Please consolidate by {deadline}."
            ),
            NotificationPhase.EMPLOYEE: (
                f"Reminder: Please enter your actuals for {month:02d}/{year} by {deadline}."
            ),
            NotificationPhase.RO_DIRECTOR: (
                f"Reminder: Actuals for {month:02d}/{year} are awaiting your approval. "
                f"Please review by {deadline}."
            ),
        }
        return templates.get(phase, "Notification reminder.")

    def _conflict_message(self, conflict, year: int, month: int) -> str:
        return (
            f"Resource allocation conflict detected for {conflict.resource.display_name} "
            f"in {month:02d}/{year}: total demand is {conflict.total_demand}% FTE but "
            f"supply is only {conflict.total_supply}% FTE. "
            f"Please review and adjust demand or supply lines."
        )

    def _missing_actuals_message(self, resource, year: int, month: int) -> str:
        return (
            f"Reminder: Actuals for {month:02d}/{year} have not been fully submitted "
            f"for {resource.display_name}. Please sign your actual lines as soon as possible."
        )

    def _subject_for_phase(self, phase: NotificationPhase) -> str:
        subjects = {
            NotificationPhase.PM_RO: "MatKat: Planning reminder",
            NotificationPhase.FINANCE: "MatKat: Finance consolidation reminder",
            NotificationPhase.EMPLOYEE: "MatKat: Actuals entry reminder",
            NotificationPhase.RO_DIRECTOR: "MatKat: Actuals approval reminder",
            NotificationPhase.CONFLICT_ALERT: "MatKat: Resource allocation conflict detected",
            NotificationPhase.MISSING_ACTUALS: "MatKat: Actuals submission reminder",
        }
        return subjects.get(phase, "MatKat: Notification")

    def _html_body(self, plain_message: str) -> str:
        """Wrap a plain message in minimal HTML for Graph sendMail."""
        safe = plain_message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return (
            f"<html><body>"
            f"<p>{safe}</p>"
            f"<p style='color:#888;font-size:12px;'>This is an automated message from MatKat.</p>"
            f"</body></html>"
        )
