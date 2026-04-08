"""Project cost models - externals and OoP equipment per project/period."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from api.app.db.base import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class ProjectExternalLine(Base):
    """External contractor/vendor cost entered by PM per project and period."""
    __tablename__ = "project_external_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)

    resource_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("resources.id"), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # name / description
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)        # additional notes
    cost: Mapped[int] = mapped_column(Integer, nullable=False)  # cents, flat cost

    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_ext_tenant_period", "tenant_id", "period_id"),
    )


class ProjectEquipmentLine(Base):
    """OoP equipment cost entered by PM per project and period."""
    __tablename__ = "project_equipment_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("periods.id"), nullable=False)

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cost: Mapped[int] = mapped_column(Integer, nullable=False)  # cents

    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_equip_tenant_period", "tenant_id", "period_id"),
    )
