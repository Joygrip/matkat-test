"""Add notification_schedules table

Revision ID: 20260427_000028
Revises: 20260421_000027
Create Date: 2026-04-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260427_000028"
down_revision: Union[str, None] = "20260421_000027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_schedules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column(
            "notification_type",
            sa.Enum(
                "conflict_alerts",
                "missing_actuals",
                "planning_reminder",
                "approval_reminder",
                name="notificationscheduletype",
            ),
            nullable=False,
        ),
        sa.Column(
            "trigger_type",
            sa.Enum(
                "day_of_month",
                "day_of_week",
                "days_before_period_close",
                name="triggertype",
            ),
            nullable=False,
        ),
        sa.Column("trigger_value", sa.Integer(), nullable=False),
        sa.Column("time_of_day", sa.String(5), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
    )
    op.create_index("ix_notification_schedules_tenant", "notification_schedules", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_schedules_tenant", table_name="notification_schedules")
    op.drop_table("notification_schedules")
    # Drop enum types (required for PostgreSQL; no-op for SQLite/SQL Server)
    sa.Enum(name="notificationscheduletype").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="triggertype").drop(op.get_bind(), checkfirst=True)
