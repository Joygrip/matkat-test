"""Add recipient role flags to notification_schedules

Adds four boolean columns to control which audience groups receive
each scheduled notification type.

Revision ID: 20260427_000017
Revises: 20260322_000016
Create Date: 2026-04-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260427_000017"
down_revision: Union[str, None] = "20260427_000028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification_schedules",
        sa.Column("notify_pm", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "notification_schedules",
        sa.Column("notify_manager", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "notification_schedules",
        sa.Column("notify_finance", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "notification_schedules",
        sa.Column("notify_employee", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("notification_schedules", "notify_employee")
    op.drop_column("notification_schedules", "notify_finance")
    op.drop_column("notification_schedules", "notify_manager")
    op.drop_column("notification_schedules", "notify_pm")
