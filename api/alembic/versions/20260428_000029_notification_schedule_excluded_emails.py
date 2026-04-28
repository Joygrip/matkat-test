"""Add excluded_emails JSON column to notification_schedules

Revision ID: 20260428_000029
Revises: 20260427_000017
Create Date: 2026-04-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260428_000029"
down_revision: Union[str, None] = "20260427_000017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification_schedules",
        sa.Column("excluded_emails", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_schedules", "excluded_emails")
