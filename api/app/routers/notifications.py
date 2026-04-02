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
from api.app.services.graph_mail import send_notification
from api.app.config import get_settings

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
    resource_id: Optional[str] = None
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


@router.post("/run-conflict-alerts")
async def run_conflict_alerts(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Detect resources where total demand FTE exceeds total supply FTE and notify RO + PM.

    Per-entity idempotent — re-running for the same period skips already-sent recipients.

    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    return service.run_conflict_alerts(year, month)


@router.post("/run-missing-actuals")
async def run_missing_actuals(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Find employees with demand lines but no fully-signed actuals and send reminders.

    Per-entity idempotent — re-running for the same period skips already-sent recipients.

    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    return service.run_missing_actuals_alerts(year, month)


@router.get("/preview-conflict-alerts")
async def preview_conflict_alerts(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Preview which resource conflicts would trigger notifications without sending anything.

    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    return service.get_preview_conflict_alerts(year, month)


@router.post("/retry-failed")
async def retry_failed_notifications(
    phase: Optional[NotificationPhase] = None,
    year: Optional[int] = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Retry FAILED notification logs that still have retry attempts remaining
    (retry_count < max_retries, default ceiling is 3).

    Filters are optional — omitting all filters retries every eligible FAILED log
    across all phases and periods for the tenant.

    Accessible to: Admin, Finance
    """
    service = NotificationsService(db, current_user)
    return service.retry_failed_notifications(phase, year, month)


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
            resource_id=log.resource_id,
            created_at=str(log.created_at),
            sent_at=str(log.sent_at) if log.sent_at else None,
        )
        for log in logs
    ]


@router.post("/smoke-test")
async def smoke_test_notification(
    to_email: Optional[str] = Query(None, description="Override recipient (defaults to caller's email)"),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
):
    """
    Send a test email to verify Microsoft Graph mail configuration.

    No database log is written — this is a connectivity probe only.
    In stub mode returns {"status": "stub"} without hitting Graph.

    Accessible to: Admin only
    """
    settings = get_settings()
    recipient = to_email or current_user.email
    if not recipient:
        return {"status": "failed", "detail": "No recipient email available.", "mode": settings.notify_mode}

    try:
        result = send_notification("test", [recipient], {})
    except Exception as exc:
        return {"status": "failed", "detail": str(exc), "mode": settings.notify_mode}

    if settings.notify_mode != "graph":
        return {"status": "stub", "to": recipient, "mode": settings.notify_mode}

    if result["sent"]:
        return {"status": "sent", "to": recipient, "mode": settings.notify_mode}
    return {"status": "failed", "to": recipient, "mode": settings.notify_mode, "detail": "See application logs for Graph error."}


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
