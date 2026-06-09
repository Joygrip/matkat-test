"""Period management service."""
from datetime import datetime, timezone
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from api.app.models.core import Period, PeriodStatus
from api.app.models.finance import FinanceSetting
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit


DEFAULT_MONTHLY_FTE_COST = 99000


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

    def list_open(self) -> list[Period]:
        """Get all open periods for the current tenant."""
        return self.db.query(Period).filter(
            and_(
                Period.tenant_id == self.current_user.tenant_id,
                Period.status == PeriodStatus.OPEN,
            )
        ).all()
    
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
        
        monthly_fte_cost = self._resolve_default_monthly_fte_cost(year, month)

        period = Period(
            tenant_id=self.current_user.tenant_id,
            year=year,
            month=month,
            monthly_fte_cost=monthly_fte_cost,
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
            new_values={
                "year": year,
                "month": month,
                "status": "open",
                "monthly_fte_cost": monthly_fte_cost,
            },
        )
        
        return period

    def create_year(self, year: int, status_mode: str = "auto") -> dict:
        """Bulk-create all 12 months for a given year, skipping months that already exist.

        status_mode:
          'auto'   → locked for year < current_year, open otherwise
          'open'   → all 12 months created as open
          'locked' → all 12 months created as locked
        """
        current_year = datetime.now(tz=timezone.utc).year

        if year < 2000 or year > current_year + 20:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": f"Year must be between 2000 and {current_year + 20}.",
                },
            )

        if status_mode == "locked":
            period_status = PeriodStatus.LOCKED
            status_used = "locked"
        elif status_mode == "open":
            period_status = PeriodStatus.OPEN
            status_used = "open"
        else:
            period_status = PeriodStatus.LOCKED if year < current_year else PeriodStatus.OPEN
            status_used = "locked" if year < current_year else "open"

        now = datetime.now(tz=timezone.utc)
        created = 0
        skipped = 0

        for month in range(1, 13):
            if self.get_by_year_month(year, month):
                skipped += 1
                continue
            monthly_fte_cost = self._resolve_default_monthly_fte_cost(year, month)
            period = Period(
                tenant_id=self.current_user.tenant_id,
                year=year,
                month=month,
                monthly_fte_cost=monthly_fte_cost,
                status=period_status,
                locked_at=now if period_status == PeriodStatus.LOCKED else None,
                locked_by=self.current_user.object_id if period_status == PeriodStatus.LOCKED else None,
            )
            self.db.add(period)
            created += 1

        if created > 0:
            self.db.commit()
            log_audit(
                self.db, self.current_user,
                action="create_year",
                entity_type="Period",
                entity_id=f"{self.current_user.tenant_id}:{year}",
                new_values={"year": year, "status": status_used, "created": created, "skipped": skipped},
            )

        return {"year": year, "status_used": status_used, "created": created, "skipped_existing": skipped}

    def _resolve_default_monthly_fte_cost(self, year: int, month: int) -> int:
        """Resolve default rate for a newly created period.

        Priority:
        1) latest existing period for tenant ordered by year/month descending
        2) global finance_settings.monthly_fte_cost
        3) static default 99000
        """
        latest_period = (
            self.db.query(Period)
            .filter(
                Period.tenant_id == self.current_user.tenant_id,
                or_(
                    Period.year < year,
                    and_(Period.year == year, Period.month < month),
                ),
            )
            .order_by(Period.year.desc(), Period.month.desc())
            .first()
        )
        if latest_period is None:
            latest_period = (
                self.db.query(Period)
                .filter(Period.tenant_id == self.current_user.tenant_id)
                .order_by(Period.year.desc(), Period.month.desc())
                .first()
            )
        if latest_period and latest_period.monthly_fte_cost:
            return int(latest_period.monthly_fte_cost)

        global_setting = (
            self.db.query(FinanceSetting)
            .filter(
                FinanceSetting.tenant_id == self.current_user.tenant_id,
                FinanceSetting.setting_key == "monthly_fte_cost",
            )
            .first()
        )
        if global_setting:
            try:
                parsed = int(global_setting.setting_value)
                if parsed > 0:
                    return parsed
            except (TypeError, ValueError):
                pass

        return DEFAULT_MONTHLY_FTE_COST
    
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
