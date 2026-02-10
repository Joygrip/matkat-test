"""Approvals models - workflow and state machine."""
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
    Enum as SQLEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class ApprovalStatus(str, enum.Enum):
    """Approval instance status."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class StepStatus(str, enum.Enum):
    """Approval step status."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SKIPPED = "skipped"


class ApprovalInstance(Base):
    """Approval instance - tracks approval workflow for a subject."""
    __tablename__ = "approval_instances"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    
    # Subject being approved
    subject_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "actuals"
    subject_id: Mapped[str] = mapped_column(String(36), nullable=False)
    
    # Status
    status: Mapped[ApprovalStatus] = mapped_column(SQLEnum(ApprovalStatus), nullable=False, default=ApprovalStatus.PENDING)
    
    # Metadata
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    steps: Mapped[list["ApprovalStep"]] = relationship(back_populates="instance", order_by="ApprovalStep.step_order")
    
    __table_args__ = (
        Index('ix_approval_subject', 'tenant_id', 'subject_type', 'subject_id'),
    )


class ApprovalStep(Base):
    """Approval step - individual approver in the workflow."""
    __tablename__ = "approval_steps"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    instance_id: Mapped[str] = mapped_column(String(36), ForeignKey("approval_instances.id"), nullable=False)
    
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 = RO, 2 = Director
    step_name: Mapped[str] = mapped_column(String(50), nullable=False)  # "RO", "Director"
    approver_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)  # User who should approve
    
    # Status
    status: Mapped[StepStatus] = mapped_column(SQLEnum(StepStatus), nullable=False, default=StepStatus.PENDING)
    
    # Action details
    actioned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actioned_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Relationships
    instance: Mapped["ApprovalInstance"] = relationship(back_populates="steps")
    
    __table_args__ = (
        Index('ix_step_instance_order', 'instance_id', 'step_order', unique=True),
    )


class ApprovalAction(Base):
    """Audit trail for approval actions."""
    __tablename__ = "approval_actions"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    instance_id: Mapped[str] = mapped_column(String(36), ForeignKey("approval_instances.id"), nullable=False)
    step_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("approval_steps.id"), nullable=True)
    
    action: Mapped[str] = mapped_column(String(50), nullable=False)  # approve, reject, skip
    performed_by: Mapped[str] = mapped_column(String(36), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index('ix_action_instance', 'instance_id'),
    )
