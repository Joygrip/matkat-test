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
    MANAGER = "Manager"
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
    cost_center_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("cost_centers.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    cost_center: Mapped[Optional["CostCenter"]] = relationship(
        back_populates="users",
        foreign_keys=[cost_center_id],
    )
    
    __table_args__ = (
        Index("ix_users_tenant_object", "tenant_id", "object_id", unique=True),
    )


class CostCenter(Base):
    """Cost Center entity (single org unit; no department)."""
    __tablename__ = "cost_centers"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Exact Graph department name used to auto-assign User.cost_center_id during sync.
    # Set by Finance/Admin; must match the 'department' field value in Entra exactly.
    graph_department_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ro_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    director_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    users: Mapped[list["User"]] = relationship(
        back_populates="cost_center",
        foreign_keys="[User.cost_center_id]",
    )
    ro_user: Mapped[Optional["User"]] = relationship(
        foreign_keys=[ro_user_id],
    )
    director: Mapped[Optional["User"]] = relationship(
        foreign_keys=[director_user_id],
    )
    resources: Mapped[list["Resource"]] = relationship(back_populates="cost_center")
    placeholders: Mapped[list["Placeholder"]] = relationship(
        "Placeholder",
        back_populates="cost_center",
        foreign_keys="[Placeholder.cost_center_id]",
    )
    
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


class ResourceType(str, enum.Enum):
    """Resource type: Employee, External, Student, or OOP (out-of-pool e.g. colleagues from Poland)."""
    EMPLOYEE = "Employee"
    EXTERNAL = "External"
    STUDENT = "Student"
    OOP = "OOP"


class Resource(Base):
    """Resource entity - an assignable person."""
    __tablename__ = "resources"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    cost_center_id: Mapped[str] = mapped_column(String(36), ForeignKey("cost_centers.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(50), nullable=False)  # HR employee ID
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    initials: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    resource_type: Mapped[ResourceType] = mapped_column(
        SQLEnum(ResourceType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ResourceType.EMPLOYEE,
    )
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
        return self.resource_type != ResourceType.EMPLOYEE


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
    """Placeholder for future/unknown resource allocation. One per cost center."""
    __tablename__ = "placeholders"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    cost_center_id: Mapped[str] = mapped_column(String(36), ForeignKey("cost_centers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    skill_profile: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estimated_cost: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    cost_center: Mapped["CostCenter"] = relationship(
        "CostCenter",
        back_populates="placeholders",
        foreign_keys=[cost_center_id],
    )
    
    __table_args__ = (
        Index("ix_placeholders_tenant_cost_center", "tenant_id", "cost_center_id", unique=True),
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


class ReportingCache(Base):
    """
    Flattened, precomputed manager → subordinate hierarchy.
    One row per (employee, manager) pair at any depth.
    Rebuilt periodically from MS Graph or on demand.
    """
    __tablename__ = "reporting_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    # Subordinate's Entra object ID
    employee_object_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # Manager's Entra object ID
    manager_object_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # 1 = direct report, 2 = skip-level, etc.
    depth: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'graph' or 'override'
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_rc_tenant_manager", "tenant_id", "manager_object_id"),
        Index(
            "ix_rc_tenant_employee_manager",
            "tenant_id", "employee_object_id", "manager_object_id",
            unique=True,
        ),
    )


class ManagerOverride(Base):
    """
    Manual manager → employee mapping for fallback when MS Graph is unavailable
    or the org chart doesn't reflect the resource allocation responsibility.
    Managed by Admins.
    """
    __tablename__ = "manager_overrides"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    employee_object_id: Mapped[str] = mapped_column(String(36), nullable=False)
    manager_object_id: Mapped[str] = mapped_column(String(36), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)  # object_id of admin

    __table_args__ = (
        Index(
            "ix_mo_tenant_employee_manager",
            "tenant_id", "employee_object_id", "manager_object_id",
            unique=True,
        ),
    )
