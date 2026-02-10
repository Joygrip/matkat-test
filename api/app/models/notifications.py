"""Notification models."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    DateTime,
    Text,
    Boolean,
    Index,
    Enum as SQLEnum,
)
from sqlalchemy.orm import Mapped, mapped_column
import enum

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class NotificationPhase(str, enum.Enum):
    """Notification phases in the monthly cycle."""
    PM_RO = "PM_RO"  # Remind PM and RO to complete planning
    FINANCE = "Finance"  # Remind Finance to review
    EMPLOYEE = "Employee"  # Remind employees to enter actuals
    RO_DIRECTOR = "RO_Director"  # Remind approvers


class NotificationStatus(str, enum.Enum):
    """Notification status."""
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class NotificationLog(Base):
    """Log of sent notifications."""
    __tablename__ = "notification_logs"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    
    phase: Mapped[NotificationPhase] = mapped_column(SQLEnum(NotificationPhase), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # Target info
    recipient_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    recipient_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Status
    status: Mapped[NotificationStatus] = mapped_column(
        SQLEnum(NotificationStatus), nullable=False, default=NotificationStatus.PENDING
    )
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Run tracking (for idempotency)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    __table_args__ = (
        Index('ix_notification_run', 'tenant_id', 'phase', 'year', 'month', 'run_id'),
    )
