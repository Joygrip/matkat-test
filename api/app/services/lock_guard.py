"""Period lock guard service for enforcing locked periods."""
from fastapi import HTTPException, status, Depends
from sqlalchemy.orm import Session
from sqlalchemy import and_

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, CurrentUser
from api.app.models.core import Period, PeriodStatus


def check_period_not_locked(
    db: Session,
    tenant_id: str,
    year: int,
    month: int,
) -> None:
    """
    Check if a period is locked and raise PERIOD_LOCKED error if so.
    
    This is the central guard for all planning/actuals mutations.
    """
    period = db.query(Period).filter(
        and_(
            Period.tenant_id == tenant_id,
            Period.year == year,
            Period.month == month,
        )
    ).first()
    
    if period and period.status == PeriodStatus.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PERIOD_LOCKED",
                "message": f"Period {year}-{month:02d} is locked. No edits allowed. Contact Finance to unlock.",
                "period_id": period.id,
                "year": year,
                "month": month,
            }
        )


class PeriodLockGuard:
    """
    Dependency class to guard against locked periods.
    
    Usage in routes:
        @router.post("/demand-lines")
        async def create_demand_line(
            data: DemandLineCreate,
            lock_guard: PeriodLockGuard = Depends(),
        ):
            lock_guard.check(data.year, data.month)
            # ... create the line
    """
    
    def __init__(
        self,
        db: Session = Depends(get_db),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        self.db = db
        self.current_user = current_user
    
    def check(self, year: int, month: int) -> None:
        """Check if the period is locked."""
        check_period_not_locked(
            self.db,
            self.current_user.tenant_id,
            year,
            month,
        )
    
    def check_period_id(self, period_id: str) -> None:
        """Check if a period (by ID) is locked."""
        period = self.db.query(Period).filter(
            and_(
                Period.id == period_id,
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        
        if not period:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "NOT_FOUND",
                    "message": "Period not found",
                }
            )
        
        if period.status == PeriodStatus.LOCKED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "PERIOD_LOCKED",
                    "message": f"Period {period.year}-{period.month:02d} is locked. No edits allowed.",
                    "period_id": period.id,
                    "year": period.year,
                    "month": period.month,
                }
            )
