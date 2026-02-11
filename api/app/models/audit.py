"""Audit log model."""
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from api.app.db.base import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. create, update, delete
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. department, demand_line
    entity_id: Mapped[str] = mapped_column(String(36), nullable=True)
    old_values: Mapped[str] = mapped_column(Text, nullable=True)  # JSON string
    new_values: Mapped[str] = mapped_column(Text, nullable=True)  # JSON string
    reason: Mapped[str] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=True)
