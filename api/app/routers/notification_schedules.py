"""Notification schedule CRUD endpoints."""
import calendar
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
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
    notification_type: NotificationScheduleType
    trigger_type: TriggerType
    trigger_value: int
    time_of_day: str
    is_active: bool = True


class NotificationScheduleUpdate(BaseModel):
    notification_type: Optional[NotificationScheduleType] = None
    trigger_type: Optional[TriggerType] = None
    trigger_value: Optional[int] = None
    time_of_day: Optional[str] = None
    is_active: Optional[bool] = None


class NotificationScheduleResponse(BaseModel):
    id: str
    tenant_id: str
    notification_type: str
    trigger_type: str
    trigger_value: int
    time_of_day: str
    is_active: bool
    last_run_at: Optional[str]
    created_at: str
    updated_at: str
    created_by: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(s: NotificationSchedule) -> NotificationScheduleResponse:
    return NotificationScheduleResponse(
        id=s.id,
        tenant_id=s.tenant_id,
        notification_type=s.notification_type.value,
        trigger_type=s.trigger_type.value,
        trigger_value=s.trigger_value,
        time_of_day=s.time_of_day,
        is_active=s.is_active,
        last_run_at=str(s.last_run_at) if s.last_run_at else None,
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


@router.post("/{schedule_id}/run")
async def run_schedule_now(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ROLES)),
):
    """Manually trigger a schedule immediately. (Admin, Finance)"""
    schedule = _get_or_404(db, schedule_id, current_user.tenant_id)

    year, month = _current_open_period(db, current_user.tenant_id)
    service = NotificationsService(db, current_user)

    ntype = schedule.notification_type
    if ntype == NotificationScheduleType.CONFLICT_ALERTS:
        result = service.run_conflict_alerts(year, month)
    elif ntype == NotificationScheduleType.MISSING_ACTUALS:
        result = service.run_missing_actuals_alerts(year, month)
    elif ntype == NotificationScheduleType.PLANNING_REMINDER:
        result = service.run_notifications(NotificationPhase.PM_RO, year, month)
    elif ntype == NotificationScheduleType.APPROVAL_REMINDER:
        result = service.run_notifications(NotificationPhase.RO_DIRECTOR, year, month)
    else:
        result = {}

    schedule.last_run_at = datetime.utcnow()
    db.commit()

    return {"schedule_id": schedule_id, "year": year, "month": month, "result": result}
