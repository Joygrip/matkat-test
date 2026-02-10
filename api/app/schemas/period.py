"""Period-related schemas."""
from datetime import datetime
from typing import Optional
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
