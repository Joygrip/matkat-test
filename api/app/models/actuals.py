"""Actuals models - time tracking and signing."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    DateTime,
    Text,
    ForeignKey,
    Index,
    CheckConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class ActualLine(Base):
    """Actual line - recorded time spent by resource on project."""
    __tablename__ = "actual_lines"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), ForeignKey("resources.id"), nullable=False)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # FTE values
    planned_fte_percent: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # From demand
    actual_fte_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # Employee signature
    employee_signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    employee_signed_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)  # Could be proxy
    is_proxy_signed: Mapped[bool] = mapped_column(Integer, default=False)  # SQLite-friendly bool
    proxy_sign_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # RO approval
    ro_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ro_approved_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    
    # Metadata
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    resource: Mapped["Resource"] = relationship("Resource")
    project: Mapped["Project"] = relationship("Project")
    
    __table_args__ = (
        # FTE must be between 5 and 100 (or 0 for no work)
        CheckConstraint(
            '(actual_fte_percent = 0) OR (actual_fte_percent >= 5 AND actual_fte_percent <= 100)',
            name='ck_actual_fte_range'
        ),
        # FTE must be divisible by 5
        CheckConstraint('actual_fte_percent % 5 = 0', name='ck_actual_fte_step'),
        # Unique per resource per project per month
        Index(
            'ix_actual_unique',
            'tenant_id', 'resource_id', 'project_id', 'year', 'month',
            unique=True,
        ),
        Index('ix_actual_tenant_period', 'tenant_id', 'year', 'month'),
        Index('ix_actual_resource', 'tenant_id', 'resource_id', 'year', 'month'),
    )
    
    @property
    def is_signed(self) -> bool:
        """Check if the actual line is signed."""
        return self.employee_signed_at is not None


# Import models used in relationships
from api.app.models.core import Resource, Project
