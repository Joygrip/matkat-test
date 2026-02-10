"""Planning models - Demand and Supply lines."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    DateTime,
    ForeignKey,
    Index,
    CheckConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class DemandLine(Base):
    """Demand line - resource allocation request from PM."""
    __tablename__ = "demand_lines"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    resource_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("resources.id"), nullable=True)
    placeholder_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("placeholders.id"), nullable=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    fte_percent: Mapped[int] = mapped_column(Integer, nullable=False)  # 5-100, step 5
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    project: Mapped["Project"] = relationship("Project")
    resource: Mapped[Optional["Resource"]] = relationship("Resource")
    placeholder: Mapped[Optional["Placeholder"]] = relationship("Placeholder")
    
    __table_args__ = (
        # FTE must be between 5 and 100
        CheckConstraint('fte_percent >= 5 AND fte_percent <= 100', name='ck_demand_fte_range'),
        # FTE must be divisible by 5
        CheckConstraint('fte_percent % 5 = 0', name='ck_demand_fte_step'),
        # XOR: exactly one of resource_id or placeholder_id must be set
        # Note: SQLite doesn't enforce CHECK well, but SQL Server does. API validates this.
        CheckConstraint(
            '(resource_id IS NOT NULL AND placeholder_id IS NULL) OR '
            '(resource_id IS NULL AND placeholder_id IS NOT NULL)',
            name='ck_demand_xor'
        ),
        # Unique constraint for resource demands
        Index(
            'ix_demand_resource_unique',
            'tenant_id', 'project_id', 'resource_id', 'year', 'month',
            unique=True,
            postgresql_where=("resource_id IS NOT NULL"),  # Filtered index for PG
        ),
        # Unique constraint for placeholder demands
        Index(
            'ix_demand_placeholder_unique',
            'tenant_id', 'project_id', 'placeholder_id', 'year', 'month',
            unique=True,
            postgresql_where=("placeholder_id IS NOT NULL"),  # Filtered index for PG
        ),
        Index('ix_demand_tenant_period', 'tenant_id', 'year', 'month'),
    )


class SupplyLine(Base):
    """Supply line - resource availability from RO."""
    __tablename__ = "supply_lines"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), ForeignKey("resources.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    fte_percent: Mapped[int] = mapped_column(Integer, nullable=False)  # 5-100, step 5
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    resource: Mapped["Resource"] = relationship("Resource")
    
    __table_args__ = (
        # FTE must be between 5 and 100
        CheckConstraint('fte_percent >= 5 AND fte_percent <= 100', name='ck_supply_fte_range'),
        # FTE must be divisible by 5
        CheckConstraint('fte_percent % 5 = 0', name='ck_supply_fte_step'),
        # Unique per resource per month
        Index(
            'ix_supply_unique',
            'tenant_id', 'resource_id', 'year', 'month',
            unique=True,
        ),
        Index('ix_supply_tenant_period', 'tenant_id', 'year', 'month'),
    )


# Import models used in relationships
from api.app.models.core import Project, Resource, Placeholder
