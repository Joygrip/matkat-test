"""APScheduler background service for automated notification dispatch.

Runs a single interval job every 15 minutes that evaluates all active
NotificationSchedule rows across all tenants and fires the appropriate
NotificationsService method when the schedule conditions are met.
"""
import calendar
import logging
from datetime import datetime, date
from typing import Tuple

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


def _open_session():
    engine = _get_or_create_engine()
    SessionLocal.configure(bind=engine)
    return SessionLocal()


def _get_open_period(db, tenant_id: str) -> Tuple[int, int]:
    """Return (year, month) of the current open period, or current calendar month."""
    period = (
        db.query(Period)
        .filter(Period.tenant_id == tenant_id, Period.status == PeriodStatus.OPEN)
        .order_by(Period.year.desc(), Period.month.desc())
        .first()
    )
    if period:
        return period.year, period.month
    today = date.today()
    return today.year, today.month


def _should_fire(schedule: NotificationSchedule, now_utc: datetime, db) -> bool:
    """Determine whether this schedule should fire on this tick."""
    today = now_utc.date()
    current_hhmm = now_utc.strftime("%H:%M")

    # Time gate: hasn't reached the scheduled time yet
    if current_hhmm < schedule.time_of_day:
        return False

    # Already fired today (covers all trigger types — each fires at most once per day)
    if schedule.last_run_at and schedule.last_run_at.date() >= today:
        return False

    trigger = schedule.trigger_type

    if trigger == TriggerType.DAY_OF_MONTH:
        return today.day == schedule.trigger_value

    if trigger == TriggerType.DAY_OF_WEEK:
        # 0=Monday … 6=Sunday, matching Python's weekday()
        return today.weekday() == schedule.trigger_value

    if trigger == TriggerType.DAYS_BEFORE_PERIOD_CLOSE:
        year, month = _get_open_period(db, schedule.tenant_id)
        _, last_day = calendar.monthrange(year, month)
        close_date = date(year, month, last_day)
        return (close_date - today).days == schedule.trigger_value

    return False


def _dispatch(service: NotificationsService, schedule: NotificationSchedule, year: int, month: int):
    ntype = schedule.notification_type
    if ntype == NotificationScheduleType.CONFLICT_ALERTS:
        return service.run_conflict_alerts(year, month)
    if ntype == NotificationScheduleType.MISSING_ACTUALS:
        return service.run_missing_actuals_alerts(year, month)
    if ntype == NotificationScheduleType.PLANNING_REMINDER:
        return service.run_notifications(NotificationPhase.PM_RO, year, month)
    if ntype == NotificationScheduleType.APPROVAL_REMINDER:
        return service.run_notifications(NotificationPhase.RO_DIRECTOR, year, month)
    return {}


def _run_tick() -> None:
    """Check all active schedules and fire those whose conditions are met."""
    db = _open_session()
    try:
        now_utc = datetime.utcnow()

        schedules = (
            db.query(NotificationSchedule)
            .filter(NotificationSchedule.is_active == True)  # noqa: E712
            .all()
        )

        for schedule in schedules:
            try:
                if not _should_fire(schedule, now_utc, db):
                    continue

                year, month = _get_open_period(db, schedule.tenant_id)

                system_user = CurrentUser(
                    tenant_id=schedule.tenant_id,
                    object_id="scheduler-system",
                    email="scheduler@system.local",
                    display_name="Scheduler",
                    role=UserRole.ADMIN,
                )

                service = NotificationsService(db, system_user)
                result = _dispatch(service, schedule, year, month)

                schedule.last_run_at = now_utc
                db.commit()

                logger.info(
                    "scheduler: fired %s (tenant=%s period=%d/%d): %s",
                    schedule.notification_type.value,
                    schedule.tenant_id,
                    year,
                    month,
                    result,
                )
            except Exception:
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


def shutdown() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Notification scheduler stopped")
