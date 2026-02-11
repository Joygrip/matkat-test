"""Planning schemas - Demand and Supply lines."""
from datetime import datetime
from typing import List, Literal, Optional, Union
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
    
    # Department / cost center context (resolved from resource or placeholder)
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    cost_center_id: Optional[str] = None
    cost_center_name: Optional[str] = None
    
    class Config:
        from_attributes = True


# ============== SUPPLY ==============

class SupplyLineBase(BaseModel):
    resource_id: str
    project_id: Optional[str] = None
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
    project_name: Optional[str] = None
    
    # Department / cost center context (resolved from resource)
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    cost_center_id: Optional[str] = None
    cost_center_name: Optional[str] = None
    
    class Config:
        from_attributes = True


# ============== BULK DEMAND ==============

class BulkDemandLineCreate(DemandLineCreate):
    pass

class BulkDemandLineUpdate(BaseModel):
    id: str
    fte_percent: int

class BulkDemandLineDelete(BaseModel):
    id: str

class BulkDemandLineAction(BaseModel):
    action: Literal['create', 'update', 'delete']
    data: Union[BulkDemandLineCreate, BulkDemandLineUpdate, BulkDemandLineDelete]

class BulkDemandLineRequest(BaseModel):
    actions: List[BulkDemandLineAction]
    all_or_nothing: bool = True

class BulkDemandLineResult(BaseModel):
    action: str
    id: str | None
    status: Literal['success', 'error']
    error: str | None = None

class BulkDemandLineResponse(BaseModel):
    results: List[BulkDemandLineResult]


# ============== BULK SUPPLY ==============

class BulkSupplyLineCreate(SupplyLineCreate):
    pass

class BulkSupplyLineUpdate(BaseModel):
    id: str
    fte_percent: int

class BulkSupplyLineDelete(BaseModel):
    id: str

class BulkSupplyLineAction(BaseModel):
    action: Literal['create', 'update', 'delete']
    data: Union[BulkSupplyLineCreate, BulkSupplyLineUpdate, BulkSupplyLineDelete]

class BulkSupplyLineRequest(BaseModel):
    actions: List[BulkSupplyLineAction]
    all_or_nothing: bool = True

class BulkSupplyLineResult(BaseModel):
    action: str
    id: str | None
    status: Literal['success', 'error']
    error: str | None = None

class BulkSupplyLineResponse(BaseModel):
    results: List[BulkSupplyLineResult]
