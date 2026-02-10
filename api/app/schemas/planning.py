"""Planning schemas - Demand and Supply lines."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator

from api.app.schemas.common import ErrorCode


class FTEValidatorMixin:
    """Mixin for FTE validation."""
    
    @field_validator('fte_percent')
    @classmethod
    def validate_fte(cls, v: int) -> int:
        if v < 5 or v > 100:
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be between 5 and 100')
        if v % 5 != 0:
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be in steps of 5')
        return v


# ============== DEMAND ==============

class DemandLineBase(BaseModel):
    project_id: str
    year: int
    month: int
    fte_percent: int
    resource_id: Optional[str] = None
    placeholder_id: Optional[str] = None


class DemandLineCreate(DemandLineBase, FTEValidatorMixin):
    """Create demand line - validates XOR and FTE."""
    
    @field_validator('placeholder_id')
    @classmethod
    def validate_xor(cls, v, info):
        resource_id = info.data.get('resource_id')
        if resource_id and v:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Cannot specify both resource_id and placeholder_id')
        if not resource_id and not v:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Must specify either resource_id or placeholder_id')
        return v


class DemandLineUpdate(BaseModel, FTEValidatorMixin):
    """Update demand line - only FTE can be updated."""
    fte_percent: int


class DemandLineResponse(DemandLineBase):
    id: str
    tenant_id: str
    period_id: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    
    # Include related names for display
    project_name: Optional[str] = None
    resource_name: Optional[str] = None
    placeholder_name: Optional[str] = None
    
    class Config:
        from_attributes = True


# ============== SUPPLY ==============

class SupplyLineBase(BaseModel):
    resource_id: str
    year: int
    month: int
    fte_percent: int


class SupplyLineCreate(SupplyLineBase, FTEValidatorMixin):
    """Create supply line."""
    pass


class SupplyLineUpdate(BaseModel, FTEValidatorMixin):
    """Update supply line - only FTE can be updated."""
    fte_percent: int


class SupplyLineResponse(SupplyLineBase):
    id: str
    tenant_id: str
    period_id: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    
    # Include related names for display
    resource_name: Optional[str] = None
    
    class Config:
        from_attributes = True
