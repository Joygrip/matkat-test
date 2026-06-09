"""Notification schedule CRUD endpoints."""
import calendar
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from api.app.auth.dependencies import require_roles, CurrentUser
from api.app.db.engine import get_db
from api.app.models.core import Period, PeriodStatus, UserRole
from api.app.models.notification_schedule import (
    NotificationSchedule,
    NotificationScheduleType,
    TriggerType,
)
from api.app.models.notifications import NotificationPhase
from api.app.services.notifications import NotificationsService

router = APIRouter(prefix="/notification-schedules", tags=["Notification Schedules"])

_ROLES = (UserRole.ADMIN, UserRole.FINANCE)


# ── Schemas ───────────────────────────────────────────────────────────────────

class NotificationScheduleCreate(BaseModel):
    notification_type: str
    trigger_type: TriggerType
    trigger_value: int
    time_of_day: str
    is_active: bool = True
    notify_pm: bool = True
    notify_manager: bool = True
    notify_finance: bool = True
    notify_employee: bool = True
    excluded_emails: list[str] = []


class NotificationScheduleUpdate(BaseModel):
    notification_type: Optional[str] = None
    trigger_type: Optional[TriggerType] = None
    trigger_value: Optional[int] = None
    time_of_day: Optional[str] = None
    is_active: Optional[bool] = None
    notify_pm: Optional[bool] = None
    notify_manager: Optional[bool] = None
    notify_finance: Optional[bool] = None
    notify_employee: Optional[bool] = None
    excluded_emails: Optional[list[str]] = None


class RunScheduleRequest(BaseModel):
    recipient_emails: Optional[list[str]] = None
    force: bool = False


class PreviewRecipient(BaseModel):
    email: str
    display_name: str
    role: str
    reason: str
    email_subject: str
    email_body_html: str
    already_notified: bool
    excluded: bool = False


class SchedulePreviewResponse(BaseModel):
    period: dict
    recipients: list[PreviewRecipient]
    total_recipients: int
    skipped: int
    would_skip: bool


class NotificationScheduleResponse(BaseModel):
    id: str
    tenant_id: str
    notification_type: str
    trigger_type: str
    trigger_value: int
    time_of_day: str
    is_active: bool
    last_run_at: Optional[str]
    notify_pm: bool
    notify_manager: bool
    notify_finance: bool
    notify_employee: bool
    excluded_emails: list[str]
    created_at: str
    updated_at: str
    created_by: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(s: NotificationSchedule) -> NotificationScheduleResponse:
    return NotificationScheduleResponse(
        id=s.id,
        tenant_id=s.tenant_id,
        notification_type=s.notification_type,
        trigger_type=s.trigger_type.value,
        trigger_value=s.trigger_value,
        time_of_day=s.time_of_day,
        is_active=s.is_active,
        last_run_at=str(s.last_run_at) if s.last_run_at else None,
        notify_pm=s.notify_pm,
        notify_manager=s.notify_manager,
        notify_finance=s.notify_finance,
        notify_employee=s.notify_employee,
        excluded_emails=s.excluded_emails or [],
        created_at=str(s.created_at),
        updated_at=str(s.updated_at),
        created_by=s.created_by,
    )


def _get_or_404(db: Session, schedule_id: str, tenant_id: str) -> NotificationSchedule:
    s = db.query(NotificationSchedule).filter(
        NotificationSchedule.id == schedule_id,
        NotificationSchedule.tenant_id == tenant_id,
    ).first()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "Schedule not found"},
        )
    return s


def _current_open_period(db: Session, tenant_id: str):
    """Return (year, month) of the nearest open period >= today.

    Mirrors scheduler._get_open_period: prefers current/future open periods so
    that historical open periods do not distort schedule previews.  Falls back
    to the most recent open period when all open periods are in the past, then
    to today's calendar month when no open period exists at all.
    """
    today = date.today()
    period = (
        db.query(Period)
        .filter(
            Period.tenant_id == tenant_id,
            Period.status == PeriodStatus.OPEN,
            or_(
                Period.year > today.year,
                and_(Period.year == today.year, Period.month >= today.month),
            ),
        )
        .order_by(Period.year.asc(), Period.month.asc())
        .first()
    )
    if period is None:
        period = (
            db.query(Period)
            .filter(Period.tenant_id == tenant_id, Period.status == PeriodStatus.OPEN)
            .order_by(Period.year.desc(), Period.month.desc())
            .first()
        )
    if period:
        return period.year, period.month
    return today.year, today.month


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[NotificationScheduleResponse])
async def list_schedules(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """List all notification schedules for the current tenant. (Admin, Finance)"""
    schedules = (
        db.query(NotificationSchedule)
        .filter(NotificationSchedule.tenant_id == current_user.tenant_id)
        .order_by(NotificationSchedule.created_at.asc())
        .all()
    )
    return [_to_response(s) for s in schedules]


@router.post("", response_model=NotificationScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    data: NotificationScheduleCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """Create a new notification schedule. (Admin, Finance)"""
    schedule = NotificationSchedule(
        tenant_id=current_user.tenant_id,
        notification_type=data.notification_type,
        trigger_type=data.trigger_type,
        trigger_value=data.trigger_value,
        time_of_day=data.time_of_day,
        is_active=data.is_active,
        notify_pm=data.notify_pm,
        notify_manager=data.notify_manager,
        notify_finance=data.notify_finance,
        notify_employee=data.notify_employee,
        excluded_emails=data.excluded_emails,
        created_by=current_user.object_id,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return _to_response(schedule)


@router.put("/{schedule_id}", response_model=NotificationScheduleResponse)
async def update_schedule(
    schedule_id: str,
    data: NotificationScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """Update an existing notification schedule. (Admin, Finance)"""
    schedule = _get_or_404(db, schedule_id, current_user.tenant_id)

    if data.notification_type is not None:
        schedule.notification_type = data.notification_type
    if data.trigger_type is not None:
        schedule.trigger_type = data.trigger_type
    if data.trigger_value is not None:
        schedule.trigger_value = data.trigger_value
    if data.time_of_day is not None:
        schedule.time_of_day = data.time_of_day
    if data.is_active is not None:
        schedule.is_active = data.is_active
    if data.notify_pm is not None:
        schedule.notify_pm = data.notify_pm
    if data.notify_manager is not None:
        schedule.notify_manager = data.notify_manager
    if data.notify_finance is not None:
        schedule.notify_finance = data.notify_finance
    if data.notify_employee is not None:
        schedule.notify_employee = data.notify_employee
    if data.excluded_emails is not None:
        schedule.excluded_emails = data.excluded_emails

    schedule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(schedule)
    return _to_response(schedule)


@router.delete("/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """Delete a notification schedule. (Admin, Finance)"""
    schedule = _get_or_404(db, schedule_id, current_user.tenant_id)
    db.delete(schedule)
    db.commit()
    return {"message": "Schedule deleted"}


@router.get("/{schedule_id}/preview", response_model=SchedulePreviewResponse)
async def preview_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """Preview recipients and email content for a schedule — read-only. (Admin, Finance)"""
    schedule = _get_or_404(db, schedule_id, current_user.tenant_id)

    # Earliest open period — consistent with scheduler.py
    period = (
        db.query(Period)
        .filter(Period.tenant_id == current_user.tenant_id, Period.status == PeriodStatus.OPEN)
        .order_by(Period.year.asc(), Period.month.asc())
        .first()
    )
    if period:
        year, month = period.year, period.month
    else:
        today = date.today()
        year, month = today.year, today.month

    month_name = calendar.month_name[month]

    # Event-driven notifications get a sample preview, not recipient lookup
    if schedule.notification_type == "approval_rejection":
        from api.app.services.graph_mail import build_approval_rejection_html
        sample_html = build_approval_rejection_html({
            "employee_name": "Anna Jensen",
            "project_name": "Project Alpha",
            "period": f"{year}-{month:02d}",
            "fte_percent": 50,
            "rejector_name": "Engineering Director",
            "comment": "FTE allocation seems incorrect, please review and resubmit.",
            "app_url": "https://matkat.ferrosanmd.com",
        })
        return SchedulePreviewResponse(
            period={"year": year, "month": month, "label": f"{month_name} {year}"},
            recipients=[PreviewRecipient(
                email="(event-driven)",
                display_name="Sent immediately to the employee on rejection",
                role="Employee",
                reason="Triggered when an approver rejects an actual",
                email_subject="MatKat — Your actual was rejected",
                email_body_html=sample_html,
                already_notified=False,
            )],
            total_recipients=1,
            skipped=0,
            would_skip=False,
        )

    service = NotificationsService(db, current_user)
    preview = service.preview_schedule(
        notification_type=schedule.notification_type,
        year=year,
        month=month,
        notify_pm=schedule.notify_pm,
        notify_manager=schedule.notify_manager,
        notify_finance=schedule.notify_finance,
        notify_employee=schedule.notify_employee,
        excluded_emails=schedule.excluded_emails or [],
    )

    return SchedulePreviewResponse(
        period={"year": year, "month": month, "label": f"{month_name} {year}"},
        recipients=[PreviewRecipient(**r) for r in preview["recipients"]],
        total_recipients=preview["total_recipients"],
        skipped=preview["skipped"],
        would_skip=preview["would_skip"],
    )


@router.post("/{schedule_id}/run")
async def run_schedule_now(
    schedule_id: str,
    body: Optional[RunScheduleRequest] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """Manually trigger a schedule immediately, respecting its recipient flags. (Admin, Finance)"""
    schedule = _get_or_404(db, schedule_id, current_user.tenant_id)

    year, month = _current_open_period(db, current_user.tenant_id)
    service = NotificationsService(db, current_user)

    recipient_emails = (body.recipient_emails or None) if body else None
    force = body.force if body else False

    excluded = schedule.excluded_emails or []
    ntype = schedule.notification_type
    if ntype == NotificationScheduleType.CONFLICT_ALERTS.value:
        result = service.run_conflict_alerts(
            year, month,
            notify_pm=schedule.notify_pm,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            recipient_emails=recipient_emails,
            excluded_emails=excluded,
            force=force,
        )
    elif ntype == NotificationScheduleType.MISSING_ACTUALS.value:
        result = service.run_missing_actuals_alerts(
            year, month,
            notify_employee=schedule.notify_employee,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            recipient_emails=recipient_emails,
            excluded_emails=excluded,
            force=force,
        )
    elif ntype == NotificationScheduleType.PLANNING_REMINDER.value:
        result = service.run_planning_reminder(
            year, month,
            notify_pm=schedule.notify_pm,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            recipient_emails=recipient_emails,
            excluded_emails=excluded,
            force=force,
        )
    elif ntype == NotificationScheduleType.APPROVAL_REMINDER.value:
        result = service.run_approval_reminder(
            year, month,
            notify_manager=schedule.notify_manager,
            notify_finance=schedule.notify_finance,
            recipient_emails=recipient_emails,
            excluded_emails=excluded,
            force=force,
        )
    else:
        result = {}

    schedule.last_run_at = datetime.utcnow()
    db.commit()

    return {"schedule_id": schedule_id, "year": year, "month": month, "result": result}
