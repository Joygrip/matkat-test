"""User-related schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from api.app.models.core import UserRole


class UserBase(BaseModel):
    """Base user properties."""
    email: str
    display_name: str
    role: UserRole
    department_id: Optional[str] = None
    cost_center_id: Optional[str] = None
    

class UserCreate(UserBase):
    """Properties for creating a user."""
    object_id: str
    manager_object_id: Optional[str] = None


class UserUpdate(BaseModel):
    """Properties for updating a user."""
    display_name: Optional[str] = None
    role: Optional[UserRole] = None
    department_id: Optional[str] = None
    cost_center_id: Optional[str] = None
    manager_object_id: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(UserBase):
    """User response."""
    id: str
    tenant_id: str
    object_id: str
    manager_object_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class MeResponse(BaseModel):
    """Current user info response."""
    tenant_id: str
    object_id: str
    email: str
    display_name: str
    role: str
    permissions: list[str]
    
    class Config:
        from_attributes = True
