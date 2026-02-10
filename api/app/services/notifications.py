"""Notifications service - sending reminders and tracking."""
import uuid
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_

from api.app.models.core import Period, User, Holiday
from api.app.models.notifications import NotificationLog, NotificationPhase, NotificationStatus
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.config import get_settings


class NotificationsService:
    """Service for notification operations."""
    
    def __init__(self, db: Session, current_user: Optional[CurrentUser] = None):
        self.db = db
        self.current_user = current_user
        self.settings = get_settings()
    
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
        # Start with base deadline
        deadline = date(year, month, base_day)
        
        # Get tenant ID for holiday lookup
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
    
    def get_preview(self, phase: NotificationPhase, year: int, month: int) -> Dict[str, Any]:
        """
        Get a preview of what notifications would be sent.
        
        Returns list of recipients without actually sending.
        """
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        
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
    
    def run_notifications(self, phase: NotificationPhase, year: int, month: int) -> Dict[str, Any]:
        """
        Run notifications for a phase (stub - records but doesn't actually send).
        
        Uses run_id for idempotency - same run won't duplicate notifications.
        """
        tenant_id = self.current_user.tenant_id if self.current_user else "unknown"
        run_id = str(uuid.uuid4())
        
        # Check if already run for this phase/period
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
            log = NotificationLog(
                tenant_id=tenant_id,
                phase=phase,
                year=year,
                month=month,
                recipient_user_id=recipient.id,
                recipient_email=recipient.email,
                status=NotificationStatus.SENT if self.settings.notify_mode == "stub" else NotificationStatus.PENDING,
                message=message_template,
                run_id=run_id,
                sent_at=datetime.utcnow() if self.settings.notify_mode == "stub" else None,
            )
            self.db.add(log)
            notifications_created.append({
                "recipient_email": recipient.email,
                "status": log.status.value,
            })
        
        self.db.commit()
        
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
    
    def _get_recipients_for_phase(self, phase: NotificationPhase) -> List[User]:
        """Get users who should receive notifications for a phase."""
        tenant_id = self.current_user.tenant_id if self.current_user else None
        
        if not tenant_id:
            return []
        
        role_map = {
            NotificationPhase.PM_RO: ["PM", "RO"],
            NotificationPhase.FINANCE: ["Finance"],
            NotificationPhase.EMPLOYEE: ["Employee"],
            NotificationPhase.RO_DIRECTOR: ["RO", "Director"],
        }
        
        roles = role_map.get(phase, [])
        
        return self.db.query(User).filter(
            and_(
                User.tenant_id == tenant_id,
                User.role.in_(roles),
                User.is_active == True,
            )
        ).all()

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

        # Load holidays for a reasonable window
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
        for _ in range(14):  # Safety limit
            if deadline.weekday() >= 5 or deadline in holiday_dates:
                deadline = deadline + timedelta(days=1)
                continue
            break

        return deadline
    
    def _get_message_template(self, phase: NotificationPhase, year: int, month: int, deadline: date) -> str:
        """Get the message template for a notification phase."""
        templates = {
            NotificationPhase.PM_RO: f"Reminder: Please complete demand and supply planning for {month:02d}/{year} by {deadline}.",
            NotificationPhase.FINANCE: f"Reminder: Planning data for {month:02d}/{year} is ready for review. Please consolidate by {deadline}.",
            NotificationPhase.EMPLOYEE: f"Reminder: Please enter your actuals for {month:02d}/{year} by {deadline}.",
            NotificationPhase.RO_DIRECTOR: f"Reminder: Actuals for {month:02d}/{year} are awaiting your approval. Please review by {deadline}.",
        }
        return templates.get(phase, "Notification reminder.")
    
    def get_logs(self, phase: Optional[NotificationPhase] = None, year: Optional[int] = None, month: Optional[int] = None) -> List[NotificationLog]:
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
