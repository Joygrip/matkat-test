"""Admin/Master data schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# Department schemas
class DepartmentBase(BaseModel):
    code: str
    name: str


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class DepartmentResponse(DepartmentBase):
    id: str
    tenant_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Cost Center schemas
class CostCenterBase(BaseModel):
    department_id: str
    code: str
    name: str
    ro_user_id: Optional[str] = None


class CostCenterCreate(CostCenterBase):
    pass


class CostCenterUpdate(BaseModel):
    department_id: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    ro_user_id: Optional[str] = None
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
    pm_user_id: Optional[str] = None
    cost_center_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    pm_user_id: Optional[str] = None
    cost_center_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_active: Optional[bool] = None


class ProjectResponse(ProjectBase):
    id: str
    tenant_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Resource schemas
class ResourceBase(BaseModel):
    cost_center_id: str
    employee_id: str
    display_name: str
    email: Optional[str] = None
    user_id: Optional[str] = None
    is_external: bool = False
    is_student: bool = False
    is_operator: bool = False
    is_equipment: bool = False
    hourly_cost: Optional[int] = None


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(BaseModel):
    cost_center_id: Optional[str] = None
    employee_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    user_id: Optional[str] = None
    is_external: Optional[bool] = None
    is_student: Optional[bool] = None
    is_operator: Optional[bool] = None
    is_equipment: Optional[bool] = None
    hourly_cost: Optional[int] = None
    is_active: Optional[bool] = None


class ResourceResponse(ResourceBase):
    id: str
    tenant_id: str
    is_active: bool
    is_oop: bool  # Computed property
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Placeholder schemas
class PlaceholderBase(BaseModel):
    name: str
    description: Optional[str] = None
    skill_profile: Optional[str] = None
    estimated_cost: Optional[int] = None


class PlaceholderCreate(PlaceholderBase):
    pass


class PlaceholderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    skill_profile: Optional[str] = None
    estimated_cost: Optional[int] = None
    is_active: Optional[bool] = None


class PlaceholderResponse(PlaceholderBase):
    id: str
    tenant_id: str
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
