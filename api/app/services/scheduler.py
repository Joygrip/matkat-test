"""APScheduler background service for automated notification dispatch.

Runs a single interval job every 15 minutes that evaluates all active
NotificationSchedule rows across all tenants and fires the appropriate
NotificationsService method when the schedule conditions are met.

Time comparisons use UTC+2 (CEST) so that schedules configured in local
business hours fire at the correct local time. last_run_at is stored as
UTC for consistency with the rest of the database.
"""
import calendar
import logging
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from api.app.auth.dependencies import CurrentUser
from api.app.db.engine import SessionLocal, _get_or_create_engine
from api.app.models.core import Period, PeriodStatus, UserRole
from api.app.models.notification_schedule import (
    NotificationSchedule,
    NotificationScheduleType,
    TriggerType,
)
from api.app.models.notifications import NotificationPhase
from api.app.services.notifications import NotificationsService

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler()
_UTC2 = timezone(timedelta(hours=2))


def _open_session():
    engine = _get_or_create_engine()
    SessionLocal.configure(bind=engine)
    return SessionLocal()


def _get_open_period(db, tenant_id: str) -> Optional[Tuple[int, int]]:
    """Return (year, month) of the earliest open period, or None if no open period exists.

    OPEN status is the product's definition of the active planning window.
    The earliest open period is always the active one regardless of today's date.
    Historical years are expected to be LOCKED by default so they do not
    appear here; if they are open they become part of the active planning window.
    """
    period = (
        db.query(Period)
        .filter(Period.tenant_id == tenant_id, Period.status == PeriodStatus.OPEN)
        .order_by(Period.year.asc(), Period.month.asc())
        .first()
    )
    if period:
        return period.year, period.month
    return None


def _should_fire(schedule: NotificationSchedule, now_local: datetime, db) -> bool:
    """Determine whether this schedule should fire on this tick.

    now_local must be expressed in UTC+2 — both the date and HH:MM comparison
    are performed in that timezone so that configured times reflect local
    business hours.  last_run_at is stored as UTC and is converted before
    the date comparison.
    """
    today = now_local.date()
    current_hhmm = now_local.strftime("%H:%M")

    # Time gate: hasn't reached the scheduled time yet (in UTC+2)
    if current_hhmm < schedule.time_of_day:
        return False

    # Already fired today in UTC+2 terms — each schedule fires at most once per day
    if schedule.last_run_at:
        # last_run_at is stored as UTC; convert to UTC+2 for the date comparison
        last_run_local = schedule.last_run_at.replace(tzinfo=timezone.utc).astimezone(_UTC2)
        if last_run_local.date() >= today:
            return False

    trigger = schedule.trigger_type

    if trigger == TriggerType.DAY_OF_MONTH:
        return today.day == schedule.trigger_value

    if trigger == TriggerType.DAY_OF_WEEK:
        # 0=Monday … 6=Sunday, matching Python's weekday()
        return today.weekday() == schedule.trigger_value

    if trigger == TriggerType.DAYS_BEFORE_PERIOD_CLOSE:
        period_ym = _get_open_period(db, schedule.tenant_id)
        if period_ym is None:
            return False
        year, month = period_ym
        _, last_day = calendar.monthrange(year, month)
        close_date = date(year, month, last_day)
        return (close_date - today).days == schedule.trigger_value

    return False


def _dispatch(service: NotificationsService, schedule: NotificationSchedule, year: int, month: int):
    excluded = schedule.excluded_emails or []
    ntype = schedule.notification_type
    if ntype == NotificationScheduleType.APPROVAL_REJECTION.value:
        return {}  # event-driven only — never fired by the scheduler
    if ntype == NotificationScheduleType.CONFLICT_ALERTS.value:
        return service.run_conflict_alerts(
            year, month,
            notify_pm=schedule.notify_pm,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            excluded_emails=excluded,
        )
    if ntype == NotificationScheduleType.MISSING_ACTUALS.value:
        return service.run_missing_actuals_alerts(
            year, month,
            notify_employee=schedule.notify_employee,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            excluded_emails=excluded,
        )
    if ntype == NotificationScheduleType.PLANNING_REMINDER.value:
        return service.run_planning_reminder(
            year, month,
            notify_pm=schedule.notify_pm,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            excluded_emails=excluded,
        )
    if ntype == NotificationScheduleType.APPROVAL_REMINDER.value:
        return service.run_approval_reminder(
            year, month,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            excluded_emails=excluded,
        )
    return {}


def _run_tick() -> None:
    """Check all active schedules and fire those whose conditions are met."""
    db = _open_session()
    try:
        # All time comparisons use UTC+2; last_run_at is stored as UTC
        now_local = datetime.now(tz=_UTC2)
        print(f"[SCHEDULER TICK] {now_local.isoformat()}")

        schedules = (
            db.query(NotificationSchedule)
            .filter(NotificationSchedule.is_active == True)  # noqa: E712
            .all()
        )

        for schedule in schedules:
            try:
                if schedule.notification_type == NotificationScheduleType.APPROVAL_REJECTION.value:
                    continue  # event-driven — never fired by the scheduler

                if not _should_fire(schedule, now_local, db):
                    continue

                period_ym = _get_open_period(db, schedule.tenant_id)
                if period_ym is None:
                    logger.warning(
                        "scheduler: no open period for tenant=%s — skipping schedule %s (type=%s)",
                        schedule.tenant_id,
                        schedule.id,
                        schedule.notification_type.value,
                    )
                    continue
                year, month = period_ym

                system_user = CurrentUser(
                    id="00000000-0000-0000-0000-000000000000",
                    tenant_id=schedule.tenant_id,
                    object_id="scheduler-system",
                    email="scheduler@system.local",
                    display_name="Scheduler",
                    role=UserRole.ADMIN,
                )

                service = NotificationsService(db, system_user)
                result = _dispatch(service, schedule, year, month)

                # Store last_run_at as UTC
                schedule.last_run_at = datetime.utcnow()
                db.commit()

                logger.info(
                    "scheduler: fired %s (tenant=%s period=%d/%d): %s",
                    schedule.notification_type.value,
                    schedule.tenant_id,
                    year,
                    month,
                    result,
                )
            except Exception as e:
                print(f"[SCHEDULER ERROR] schedule={schedule.id}: {e}")
                logger.exception(
                    "scheduler: error processing schedule %s (type=%s tenant=%s)",
                    schedule.id,
                    schedule.notification_type.value,
                    schedule.tenant_id,
                )
                db.rollback()
    finally:
        db.close()


def start() -> None:
    _scheduler.add_job(
        _run_tick,
        IntervalTrigger(minutes=15),
        id="notification_scheduler",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Notification scheduler started (interval: 15 minutes)")
    print("[SCHEDULER] Notification scheduler started (interval: 15 minutes)")


def shutdown() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Notification scheduler stopped")
