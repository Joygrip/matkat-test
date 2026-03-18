"""Finance settings model."""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class FinanceSetting(Base):
    """Tenant-level key/value settings for the Finance module."""
    __tablename__ = "finance_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    setting_key: Mapped[str] = mapped_column(String(100), nullable=False)
    setting_value: Mapped[str] = mapped_column(String(500), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(36), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index('ix_finance_settings_tenant_key', 'tenant_id', 'setting_key', unique=True),
    )
