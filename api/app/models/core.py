"""Core database models."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    Index,
    Enum as SQLEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    """User roles matching Entra App Roles."""
    ADMIN = "Admin"
    FINANCE = "Finance"
    PM = "PM"
    RO = "RO"
    DIRECTOR = "Director"
    EMPLOYEE = "Employee"


class PeriodStatus(str, enum.Enum):
    """Period lifecycle status."""
    OPEN = "open"
    LOCKED = "locked"


class User(Base):
    """User entity - synced from Entra ID."""
    __tablename__ = "users"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    object_id: Mapped[str] = mapped_column(String(36), nullable=False)  # Entra Object ID
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SQLEnum(UserRole), nullable=False, default=UserRole.EMPLOYEE)
    manager_object_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    department_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("departments.id"), nullable=True)
    cost_center_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("cost_centers.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    department: Mapped[Optional["Department"]] = relationship(back_populates="users")
    cost_center: Mapped[Optional["CostCenter"]] = relationship(
        back_populates="users",
        foreign_keys=[cost_center_id],
    )
    
    __table_args__ = (
        Index("ix_users_tenant_object", "tenant_id", "object_id", unique=True),
    )


class Department(Base):
    """Department entity."""
    __tablename__ = "departments"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    users: Mapped[list["User"]] = relationship(back_populates="department")
    cost_centers: Mapped[list["CostCenter"]] = relationship(back_populates="department")
    
    __table_args__ = (
        Index("ix_departments_tenant_code", "tenant_id", "code", unique=True),
    )


class CostCenter(Base):
    """Cost Center entity."""
    __tablename__ = "cost_centers"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    department_id: Mapped[str] = mapped_column(String(36), ForeignKey("departments.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ro_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    department: Mapped["Department"] = relationship(back_populates="cost_centers")
    users: Mapped[list["User"]] = relationship(
        back_populates="cost_center",
        foreign_keys="[User.cost_center_id]",
    )
    ro_user: Mapped[Optional["User"]] = relationship(
        foreign_keys=[ro_user_id],
    )
    resources: Mapped[list["Resource"]] = relationship(back_populates="cost_center")
    
    __table_args__ = (
        Index("ix_cost_centers_tenant_code", "tenant_id", "code", unique=True),
    )


class Project(Base):
    """Project entity."""
    __tablename__ = "projects"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    pm_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    cost_center_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("cost_centers.id"), nullable=True)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_projects_tenant_code", "tenant_id", "code", unique=True),
    )


class Resource(Base):
    """Resource entity - an assignable person."""
    __tablename__ = "resources"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    cost_center_id: Mapped[str] = mapped_column(String(36), ForeignKey("cost_centers.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(50), nullable=False)  # HR employee ID
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_external: Mapped[bool] = mapped_column(Boolean, default=False)
    is_student: Mapped[bool] = mapped_column(Boolean, default=False)
    is_operator: Mapped[bool] = mapped_column(Boolean, default=False)
    is_equipment: Mapped[bool] = mapped_column(Boolean, default=False)
    hourly_cost: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # For OoP tracking
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    cost_center: Mapped["CostCenter"] = relationship(back_populates="resources")
    
    __table_args__ = (
        Index("ix_resources_tenant_employee", "tenant_id", "employee_id", unique=True),
    )
    
    @property
    def is_oop(self) -> bool:
        """Check if resource is Out of Pool (excluded from internal FTE)."""
        return self.is_external or self.is_student or self.is_operator or self.is_equipment


class Period(Base):
    """Planning/Actuals period (monthly)."""
    __tablename__ = "periods"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[PeriodStatus] = mapped_column(SQLEnum(PeriodStatus), nullable=False, default=PeriodStatus.OPEN)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    locked_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    lock_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_periods_tenant_year_month", "tenant_id", "year", "month", unique=True),
    )


class Placeholder(Base):
    """Placeholder for future/unknown resource allocation."""
    __tablename__ = "placeholders"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    skill_profile: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estimated_cost: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_placeholders_tenant_name", "tenant_id", "name", unique=True),
    )


class Settings(Base):
    """Tenant-specific settings."""
    __tablename__ = "settings"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_settings_tenant_key", "tenant_id", "key", unique=True),
    )


class Holiday(Base):
    """Holiday calendar for deadline calculations."""
    __tablename__ = "holidays"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_company_wide: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_holidays_tenant_date", "tenant_id", "date", unique=True),
    )


class AuditLog(Base):
    """Audit log for all mutations."""
    __tablename__ = "audit_logs"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    old_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    new_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_audit_logs_tenant_created", "tenant_id", "created_at"),
        Index("ix_audit_logs_entity", "tenant_id", "entity_type", "entity_id"),
    )
