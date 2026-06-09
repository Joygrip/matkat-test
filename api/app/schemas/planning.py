"""Planning schemas - Demand and Supply lines."""
from datetime import datetime
from typing import List, Literal, Optional, Union
from pydantic import BaseModel, field_validator, model_validator

from api.app.schemas.common import ErrorCode


class PeriodMapping(BaseModel):
    from_period_id: str
    to_period_id: str


class FTEValidatorMixin:
    """Mixin for FTE validation."""
    
    @field_validator('fte_percent')
    @classmethod
    def validate_fte(cls, v: int) -> int:
        if v < 1 or v > 100:
            raise ValueError(f'{ErrorCode.FTE_INVALID}: FTE must be between 1 and 100')
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
    """Update demand line - FTE and resource/placeholder can be updated."""
    fte_percent: int
    resource_id: Optional[str] = None
    placeholder_id: Optional[str] = None


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
    resource_initials: Optional[str] = None
    placeholder_name: Optional[str] = None

    # Cost center context (resolved from resource or placeholder)
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
    """Update supply line - FTE and resource/project can be updated."""
    fte_percent: int
    resource_id: Optional[str] = None
    project_id: Optional[str] = None


class SupplyLineResponse(SupplyLineBase):
    id: str
    tenant_id: str
    period_id: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    
    # Include related names for display
    resource_name: Optional[str] = None
    resource_initials: Optional[str] = None
    project_name: Optional[str] = None

    # Cost center context (resolved from resource)
    cost_center_id: Optional[str] = None
    cost_center_name: Optional[str] = None
    
    class Config:
        from_attributes = True


# ============== GROUP SUPPLY OPERATIONS ==============

class SupplyGroupDeleteRequest(BaseModel):
    """Request body for deleting all supply lines in a resource+project group."""
    resource_id: str
    project_id: Optional[str] = None
    period_ids: List[str]

    @field_validator('period_ids')
    @classmethod
    def validate_period_ids_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('period_ids must not be empty')
        return v


class SupplyGroupMoveRequest(BaseModel):
    """Request body for moving all supply lines from one resource to another."""
    from_resource_id: str
    to_resource_id: str
    project_id: Optional[str] = None
    to_project_id: Optional[str] = None
    period_ids: List[str]
    confirm_cap: bool = False
    operation: Literal["move", "copy"] = "move"
    period_mappings: Optional[List[PeriodMapping]] = None
    merge_mode: Literal["add", "replace"] = "add"

    @field_validator('period_ids')
    @classmethod
    def validate_period_ids_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('period_ids must not be empty')
        return v

    @model_validator(mode='after')
    def validate_different_target(self) -> 'SupplyGroupMoveRequest':
        has_period_shift = bool(
            self.period_mappings and
            any(m.from_period_id != m.to_period_id for m in self.period_mappings)
        )
        if self.from_resource_id == self.to_resource_id and self.project_id == self.to_project_id and not has_period_shift:
            raise ValueError('Target resource and project cannot be the same as source')
        return self


# ============== GROUP DEMAND OPERATIONS ==============

class DemandGroupDeleteRequest(BaseModel):
    """Request body for deleting all demand lines in a resource+project group."""
    resource_id: Optional[str] = None
    placeholder_id: Optional[str] = None
    project_id: str
    period_ids: List[str]

    @field_validator('period_ids')
    @classmethod
    def validate_period_ids_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('period_ids must not be empty')
        return v

    @model_validator(mode='after')
    def validate_xor(self) -> 'DemandGroupDeleteRequest':
        if self.resource_id and self.placeholder_id:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Cannot specify both resource_id and placeholder_id')
        if not self.resource_id and not self.placeholder_id:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Must specify either resource_id or placeholder_id')
        return self


class DemandGroupMoveRequest(BaseModel):
    """Request body for moving all demand lines in a resource+project group to a different resource/placeholder."""
    from_resource_id: Optional[str] = None
    from_placeholder_id: Optional[str] = None
    to_resource_id: Optional[str] = None
    to_placeholder_id: Optional[str] = None
    project_id: str
    to_project_id: str
    period_ids: List[str]
    confirm_cap: bool = False
    operation: Literal["move", "copy"] = "move"
    period_mappings: Optional[List[PeriodMapping]] = None
    merge_mode: Literal["add", "replace"] = "add"

    @field_validator('period_ids')
    @classmethod
    def validate_period_ids_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('period_ids must not be empty')
        return v

    @model_validator(mode='after')
    def validate_identifiers(self) -> 'DemandGroupMoveRequest':
        # Source XOR
        if self.from_resource_id and self.from_placeholder_id:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Cannot specify both from_resource_id and from_placeholder_id')
        if not self.from_resource_id and not self.from_placeholder_id:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Must specify either from_resource_id or from_placeholder_id')
        # Target XOR
        if self.to_resource_id and self.to_placeholder_id:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Cannot specify both to_resource_id and to_placeholder_id')
        if not self.to_resource_id and not self.to_placeholder_id:
            raise ValueError(f'{ErrorCode.DEMAND_XOR}: Must specify either to_resource_id or to_placeholder_id')
        # Source != Target: must differ in resource/placeholder OR project OR periods
        # Allow same identity when period_mappings provide an actual period shift (self-row shift)
        has_period_shift = bool(
            self.period_mappings and
            any(m.from_period_id != m.to_period_id for m in self.period_mappings)
        )
        if self.from_resource_id and self.from_resource_id == self.to_resource_id and self.project_id == self.to_project_id and not has_period_shift:
            raise ValueError('Target resource and project cannot be the same as source')
        if self.from_placeholder_id and self.from_placeholder_id == self.to_placeholder_id and self.project_id == self.to_project_id and not has_period_shift:
            raise ValueError('Target placeholder and project cannot be the same as source')
        return self


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
