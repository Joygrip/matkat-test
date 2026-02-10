"""Period management endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.schemas.period import (
    PeriodCreate,
    PeriodResponse,
    PeriodLockRequest,
    PeriodUnlockRequest,
)
from api.app.services.period import get_period_service

router = APIRouter(prefix="/periods", tags=["Periods"])


@router.get("", response_model=list[PeriodResponse])
async def list_periods(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all periods for the current tenant.
    Available to all authenticated users.
    """
    service = get_period_service(db, current_user)
    return service.get_all()


@router.get("/current", response_model=PeriodResponse)
async def get_current_period(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get the current month's period.
    Creates one if it doesn't exist (Finance only can create).
    """
    service = get_period_service(db, current_user)
    period = service.get_current()
    
    if not period:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "NOT_FOUND",
                "message": "No period exists for the current month. Finance must create it.",
            }
        )
    
    return period


@router.get("/{period_id}", response_model=PeriodResponse)
async def get_period(
    period_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get a specific period by ID.
    """
    service = get_period_service(db, current_user)
    period = service.get_by_id(period_id)
    
    if not period:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "NOT_FOUND",
                "message": "Period not found",
            }
        )
    
    return period


@router.post("", response_model=PeriodResponse)
async def create_period(
    data: PeriodCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Create a new period.
    Finance and Admin only.
    """
    service = get_period_service(db, current_user)
    return service.create(data.year, data.month)


@router.post("/{period_id}/lock", response_model=PeriodResponse)
async def lock_period(
    period_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Lock a period, preventing further edits to demand/supply/actuals.
    Finance and Admin only.
    """
    service = get_period_service(db, current_user)
    return service.lock(period_id)


@router.post("/{period_id}/unlock", response_model=PeriodResponse)
async def unlock_period(
    period_id: str,
    data: PeriodUnlockRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Unlock a period to allow edits again.
    Finance and Admin only. Requires a reason.
    """
    service = get_period_service(db, current_user)
    return service.unlock(period_id, data.reason)
