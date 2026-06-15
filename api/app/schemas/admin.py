"""Admin/Master data schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


# Cost Center schemas
class CostCenterBase(BaseModel):
    code: str
    name: str
    graph_department_name: Optional[str] = None
    ro_user_id: Optional[str] = None
    director_user_id: Optional[str] = None
    location: Optional[str] = None


class CostCenterCreate(CostCenterBase):
    pass


class CostCenterUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    graph_department_name: Optional[str] = None
    ro_user_id: Optional[str] = None
    director_user_id: Optional[str] = None
    location: Optional[str] = None
    is_active: Optional[bool] = None


class CostCenterResponse(CostCenterBase):
    id: str
    tenant_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Project schemas
class ProjectBase(BaseModel):
    code: str
    name: str
    pm_user_ids: list[str] = []
    cost_center_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    pm_user_ids: Optional[list[str]] = None
    cost_center_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_active: Optional[bool] = None


class ProjectResponse(BaseModel):
    id: str
    tenant_id: str
    code: str
    name: str
    pm_user_ids: list[str] = []
    cost_center_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# Resource schemas - resource_type: Employee | External | Student | OOP
ResourceTypeLiteral = str  # "Employee" | "External" | "Student" | "OOP"


class ResourceBase(BaseModel):
    cost_center_id: str
    employee_id: str
    display_name: str
    initials: Optional[str] = None
    email: Optional[str] = None
    user_id: Optional[str] = None
    resource_type: str = "Employee"  # Employee | External | Student | OOP
    hourly_cost: Optional[int] = None


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(BaseModel):
    cost_center_id: Optional[str] = None
    employee_id: Optional[str] = None
    display_name: Optional[str] = None
    initials: Optional[str] = None
    email: Optional[str] = None
    user_id: Optional[str] = None
    resource_type: Optional[str] = None
    hourly_cost: Optional[int] = None
    is_active: Optional[bool] = None


class ResourceResponse(ResourceBase):
    id: str
    tenant_id: str
    is_active: bool
    is_oop: bool  # Computed: resource_type != "Employee"
    created_at: datetime
    updated_at: datetime
    user_role: Optional[str] = None

    class Config:
        from_attributes = True


# Placeholder schemas - scoped to a cost center; a cost center can have several
class PlaceholderBase(BaseModel):
    name: str
    cost_center_id: str
    description: Optional[str] = None
    skill_profile: Optional[str] = None
    estimated_cost: Optional[int] = None


class PlaceholderCreate(BaseModel):
    """Create placeholder for a cost center."""
    cost_center_id: str
    name: Optional[str] = None  # Default "Placeholder" if not set
    description: Optional[str] = None
    skill_profile: Optional[str] = None
    estimated_cost: Optional[int] = None


class PlaceholderUpdate(BaseModel):
    """Update placeholder; cost_center_id cannot be changed."""
    name: Optional[str] = None
    description: Optional[str] = None
    skill_profile: Optional[str] = None
    estimated_cost: Optional[int] = None
    is_active: Optional[bool] = None


class PlaceholderResponse(PlaceholderBase):
    id: str
    tenant_id: str
    cost_center_id: str
    cost_center_name: Optional[str] = None
    created_by: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Holiday schemas
class HolidayBase(BaseModel):
    date: datetime
    name: str
    is_company_wide: bool = True


class HolidayCreate(HolidayBase):
    pass


class HolidayResponse(HolidayBase):
    id: str
    tenant_id: str
    created_at: datetime
    
    class Config:
        from_attributes = True


# Settings schemas
class SettingsBase(BaseModel):
    key: str
    value: str
    description: Optional[str] = None


class SettingsCreate(SettingsBase):
    pass


class SettingsUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None


class SettingsResponse(SettingsBase):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Approval Delegate schemas
class ApprovalDelegateCreate(BaseModel):
    delegator_id: Optional[str] = None  # omit when caller is Manager — backend fills from token
    delegate_id: str
    note: Optional[str] = None


class ApprovalDelegatePatch(BaseModel):
    is_active: Optional[bool] = None
    note: Optional[str] = None


class ApprovalDelegateResponse(BaseModel):
    id: str
    tenant_id: str
    delegator_id: str
    delegate_id: str
    delegator_name: Optional[str] = None
    delegate_name: Optional[str] = None
    is_active: bool
    note: Optional[str]
    created_at: datetime
    created_by: str

    model_config = ConfigDict(from_attributes=True)
