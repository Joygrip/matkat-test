"""Period management service."""
from datetime import datetime
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_

from api.app.models.core import Period, PeriodStatus
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit


class PeriodService:
    """Service for period management operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user
    
    def get_all(self) -> list[Period]:
        """Get all periods for the current tenant."""
        return self.db.query(Period).filter(
            Period.tenant_id == self.current_user.tenant_id
        ).order_by(Period.year.desc(), Period.month.desc()).all()
    
    def get_by_id(self, period_id: str) -> Optional[Period]:
        """Get a period by ID."""
        return self.db.query(Period).filter(
            and_(
                Period.id == period_id,
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).first()
    
    def get_by_year_month(self, year: int, month: int) -> Optional[Period]:
        """Get a period by year and month."""
        return self.db.query(Period).filter(
            and_(
                Period.tenant_id == self.current_user.tenant_id,
                Period.year == year,
                Period.month == month,
            )
        ).first()
    
    def get_current(self) -> Optional[Period]:
        """Get the current month's period."""
        now = datetime.utcnow()
        return self.get_by_year_month(now.year, now.month)
    
    def create(self, year: int, month: int) -> Period:
        """Create a new period."""
        # Check if period already exists
        existing = self.get_by_year_month(year, month)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONFLICT",
                    "message": f"Period {year}-{month:02d} already exists",
                }
            )
        
        period = Period(
            tenant_id=self.current_user.tenant_id,
            year=year,
            month=month,
            status=PeriodStatus.OPEN,
        )
        self.db.add(period)
        self.db.commit()
        self.db.refresh(period)
        
        log_audit(
            self.db, self.current_user,
            action="create",
            entity_type="Period",
            entity_id=period.id,
            new_values={"year": year, "month": month, "status": "open"},
        )
        
        return period
    
    def lock(self, period_id: str) -> Period:
        """Lock a period (Finance only)."""
        period = self.get_by_id(period_id)
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
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Period is already locked",
                }
            )
        
        old_status = period.status.value
        period.status = PeriodStatus.LOCKED
        period.locked_at = datetime.utcnow()
        period.locked_by = self.current_user.object_id
        period.lock_reason = None
        
        self.db.commit()
        self.db.refresh(period)
        
        log_audit(
            self.db, self.current_user,
            action="lock",
            entity_type="Period",
            entity_id=period.id,
            old_values={"status": old_status},
            new_values={"status": "locked", "locked_at": str(period.locked_at)},
        )
        
        return period
    
    def unlock(self, period_id: str, reason: str) -> Period:
        """Unlock/reopen a period (Finance only, requires reason)."""
        if not reason or not reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Reason is required to unlock a period",
                }
            )
        
        period = self.get_by_id(period_id)
        if not period:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "NOT_FOUND",
                    "message": "Period not found",
                }
            )
        
        if period.status == PeriodStatus.OPEN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Period is already open",
                }
            )
        
        old_status = period.status.value
        old_locked_at = str(period.locked_at) if period.locked_at else None
        
        period.status = PeriodStatus.OPEN
        period.lock_reason = reason.strip()  # Store the reason for unlocking
        # Keep locked_at and locked_by for audit trail
        
        self.db.commit()
        self.db.refresh(period)
        
        log_audit(
            self.db, self.current_user,
            action="unlock",
            entity_type="Period",
            entity_id=period.id,
            old_values={"status": old_status, "locked_at": old_locked_at},
            new_values={"status": "open"},
            reason=reason.strip(),
        )
        
        return period
    
    def is_locked(self, year: int, month: int) -> bool:
        """Check if a specific period is locked."""
        period = self.get_by_year_month(year, month)
        return period is not None and period.status == PeriodStatus.LOCKED
    
    def require_open(self, year: int, month: int) -> None:
        """Raise exception if period is locked."""
        period = self.get_by_year_month(year, month)
        if period and period.status == PeriodStatus.LOCKED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "PERIOD_LOCKED",
                    "message": f"Period {year}-{month:02d} is locked. Contact Finance to unlock.",
                }
            )


def get_period_service(db: Session, current_user: CurrentUser) -> PeriodService:
    """Factory function to create PeriodService."""
    return PeriodService(db, current_user)
