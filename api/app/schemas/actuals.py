"""Actuals schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator

from api.app.schemas.common import ErrorCode


class ActualLineBase(BaseModel):
    resource_id: str
    project_id: str
    year: int
    month: int
    actual_fte_percent: int
    planned_fte_percent: Optional[int] = None


class ActualLineCreate(ActualLineBase):
    """Create actual line."""
    
    @field_validator('actual_fte_percent')
    @classmethod
    def validate_fte(cls, v: int) -> int:
        if v != 0 and (v < 5 or v > 100):
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be 0 or between 5 and 100')
        if v % 5 != 0:
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be in steps of 5')
        return v


class ActualLineUpdate(BaseModel):
    """Update actual line - only FTE can be updated before signing."""
    actual_fte_percent: int
    
    @field_validator('actual_fte_percent')
    @classmethod
    def validate_fte(cls, v: int) -> int:
        if v != 0 and (v < 5 or v > 100):
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be 0 or between 5 and 100')
        if v % 5 != 0:
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be in steps of 5')
        return v


class ActualLineResponse(ActualLineBase):
    id: str
    tenant_id: str
    period_id: str
    employee_signed_at: Optional[datetime] = None
    employee_signed_by: Optional[str] = None
    is_proxy_signed: bool
    proxy_sign_reason: Optional[str] = None
    ro_approved_at: Optional[datetime] = None
    ro_approved_by: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime
    
    # Display names
    resource_name: Optional[str] = None
    project_name: Optional[str] = None
    
    class Config:
        from_attributes = True


class SignRequest(BaseModel):
    """Request to sign actuals."""
    pass


class ProxySignRequest(BaseModel):
    """Request to proxy sign actuals on behalf of employee."""
    reason: str
    
    @field_validator('reason')
    @classmethod
    def validate_reason(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Reason is required for proxy signing')
        return v.strip()


class ActualsOverLimitError(BaseModel):
    """Error response when actuals exceed 100%."""
    code: str = ErrorCode.ACTUALS_OVER_100
    message: str
    total_percent: int
    resource_id: str
    year: int
    month: int
    offending_line_ids: list[str]
