"""Notifications endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.models.notifications import NotificationPhase
from api.app.services.notifications import NotificationsService

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationLogResponse(BaseModel):
    id: str
    phase: str
    year: int
    month: int
    recipient_email: Optional[str]
    status: str
    message: Optional[str]
    run_id: str
    created_at: str
    sent_at: Optional[str]


@router.get("/preview")
async def preview_notifications(
    phase: NotificationPhase = Query(..., description="Notification phase"),
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Preview what notifications would be sent without actually sending them.
    
    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    return service.get_preview(phase, year, month)


@router.post("/run")
async def run_notifications(
    phase: NotificationPhase = Query(..., description="Notification phase"),
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Run notifications for a specific phase.
    
    In stub mode, notifications are recorded but not actually sent.
    Idempotent - running twice for the same phase/period won't duplicate notifications.
    
    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    return service.run_notifications(phase, year, month)


@router.get("/logs", response_model=list[NotificationLogResponse])
async def get_notification_logs(
    phase: Optional[NotificationPhase] = None,
    year: Optional[int] = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Get notification logs with optional filters.
    
    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    logs = service.get_logs(phase, year, month)
    
    return [
        NotificationLogResponse(
            id=log.id,
            phase=log.phase.value,
            year=log.year,
            month=log.month,
            recipient_email=log.recipient_email,
            status=log.status.value,
            message=log.message,
            run_id=log.run_id,
            created_at=str(log.created_at),
            sent_at=str(log.sent_at) if log.sent_at else None,
        )
        for log in logs
    ]


@router.get("/deadline")
async def calculate_deadline(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    base_day: int = Query(5, ge=1, le=28),
    phase: Optional[NotificationPhase] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Calculate the notification deadline for a given month, considering holidays.
    
    Accessible to: All authenticated users
    """
    service = NotificationsService(db, current_user)
    if phase:
        deadline = service.calculate_phase_deadline(phase, year, month)
    else:
        deadline = service.calculate_deadline(year, month, base_day)
    
    return {
        "year": year,
        "month": month,
        "base_day": base_day,
        "phase": phase.value if phase else None,
        "deadline": str(deadline),
    }
