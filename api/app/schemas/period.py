"""Period-related schemas."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel

from api.app.models.core import PeriodStatus


class PeriodBase(BaseModel):
    """Base period properties."""
    year: int
    month: int


class PeriodCreate(PeriodBase):
    """Properties for creating a period."""
    pass


class PeriodResponse(PeriodBase):
    """Period response."""
    id: str
    tenant_id: str
    monthly_fte_cost: int
    status: PeriodStatus
    locked_at: Optional[datetime] = None
    locked_by: Optional[str] = None
    lock_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PeriodLockRequest(BaseModel):
    """Request to lock a period."""
    pass


class PeriodUnlockRequest(BaseModel):
    """Request to unlock a period."""
    reason: str


class CreateYearRequest(BaseModel):
    """Request to bulk-create all 12 months of a given year."""
    year: int
    status: Literal["auto", "open", "locked"] = "auto"


class CreateYearResponse(BaseModel):
    """Result of a bulk-create-year operation."""
    year: int
    status_used: str
    created: int
    skipped_existing: int
