"""Consolidation models - OoP lines and publish snapshots."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    DateTime,
    Text,
    Boolean,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class OopLine(Base):
    """Out-of-Pocket cost line - externals, students, operators, equipment."""
    __tablename__ = "oop_lines"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), ForeignKey("resources.id"), nullable=False)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # OoP-specific fields
    hours: Mapped[int] = mapped_column(Integer, nullable=False)  # Hours worked
    hourly_rate: Mapped[int] = mapped_column(Integer, nullable=False)  # Cost per hour in cents
    total_cost: Mapped[int] = mapped_column(Integer, nullable=False)  # Total cost in cents
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Audit
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('ix_oop_tenant_period', 'tenant_id', 'period_id'),
    )


class PublishSnapshot(Base):
    """Published snapshot of planning data at a point in time."""
    __tablename__ = "publish_snapshots"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)
    
    name: Mapped[str] = mapped_column(String(255), nullable=False)  # e.g., "February 2026 Final"
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Metadata
    published_by: Mapped[str] = mapped_column(String(36), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Relationships
    lines: Mapped[list["PublishSnapshotLine"]] = relationship(back_populates="snapshot")
    
    __table_args__ = (
        Index('ix_snapshot_tenant_period', 'tenant_id', 'period_id'),
    )


class PublishSnapshotLine(Base):
    """Individual line in a published snapshot - immutable copy of planning data."""
    __tablename__ = "publish_snapshot_lines"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    snapshot_id: Mapped[str] = mapped_column(String(36), ForeignKey("publish_snapshots.id"), nullable=False)
    
    # Snapshot data (denormalized copy of original data)
    line_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "demand", "supply", "actual", "oop"
    project_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    project_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    resource_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    placeholder_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    placeholder_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    fte_percent: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Relationships
    snapshot: Mapped["PublishSnapshot"] = relationship(back_populates="lines")
    
    __table_args__ = (
        Index('ix_snapshotline_snapshot', 'snapshot_id'),
    )
