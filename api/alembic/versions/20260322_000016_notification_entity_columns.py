"""Add resource_id to notification_logs for per-entity idempotency

Supports the new ConflictAlert and MissingActuals notification phases which
track deduplication at (tenant, phase, year, month, resource_id, recipient)
granularity rather than the legacy global-per-phase guard.

Revision ID: 20260322_000016
Revises: 20260322_000015
Create Date: 2026-03-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260322_000016"
down_revision: Union[str, None] = "20260322_000015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add entity tracking column (nullable — backwards compatible with legacy phases)
    op.add_column(
        "notification_logs",
        sa.Column("resource_id", sa.String(36), nullable=True),
    )

    # Per-entity idempotency index for ConflictAlert / MissingActuals phases.
    # NOTE: The 'phase' column is stored as VARCHAR (String(20)) in the original
    # migration (20260202_000006), not a native SQL ENUM, so the new phase values
    # "ConflictAlert" and "MissingActuals" fit without any ALTER TYPE.
    op.create_index(
        "ix_notification_entity",
        "notification_logs",
        ["tenant_id", "phase", "year", "month", "resource_id", "recipient_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_entity", table_name="notification_logs")
    op.drop_column("notification_logs", "resource_id")
