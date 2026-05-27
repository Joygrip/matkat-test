"""Notification schedule model."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    Boolean,
    DateTime,
    Enum as SQLEnum,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column
import enum

from api.app.db.base import Base


def _generate_uuid() -> str:
    return str(uuid.uuid4())


class NotificationScheduleType(str, enum.Enum):
    CONFLICT_ALERTS    = "conflict_alerts"
    MISSING_ACTUALS    = "missing_actuals"
    PLANNING_REMINDER  = "planning_reminder"
    APPROVAL_REMINDER  = "approval_reminder"
    APPROVAL_REJECTION = "approval_rejection"


class TriggerType(str, enum.Enum):
    DAY_OF_MONTH = "day_of_month"
    DAY_OF_WEEK = "day_of_week"
    DAYS_BEFORE_PERIOD_CLOSE = "days_before_period_close"


class NotificationSchedule(Base):
    """Recurring schedule for automated notification dispatch."""
    __tablename__ = "notification_schedules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_generate_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    notification_type: Mapped[NotificationScheduleType] = mapped_column(
        SQLEnum(NotificationScheduleType), nullable=False
    )
    trigger_type: Mapped[TriggerType] = mapped_column(
        SQLEnum(TriggerType), nullable=False
    )
    # day_of_month: 1-28 | day_of_week: 0-6 | days_before_period_close: 1-14
    trigger_value: Mapped[int] = mapped_column(Integer, nullable=False)

    # "HH:MM" in UTC, e.g. "07:00"
    time_of_day: Mapped[str] = mapped_column(String(5), nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Recipient role flags — which audience groups receive this schedule's notifications
    notify_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_manager: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_finance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_employee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    excluded_emails: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
