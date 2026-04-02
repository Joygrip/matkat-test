"""Add idempotency_key, retry_count, max_retries to notification_logs

Revision ID: 20260402_000024
Revises: 20260402_000023
Create Date: 2026-04-02

Adds three columns to notification_logs for production-safe reliability:
  - idempotency_key: DB-enforced UNIQUE constraint prevents duplicate sends
    under concurrent runs (replaces pure application-level SELECT-before-INSERT).
  - retry_count: how many send attempts have been made for this log entry.
  - max_retries: ceiling on retry attempts (default 3).

The migration backfills idempotency_key for all existing rows using the same
key format the application code will use going forward:
  legacy phases:   {tenant_id}|{phase}|{year}|{month}|{recipient_user_id}
  targeted alerts: {tenant_id}|{phase}|{year}|{month}|{resource_id}|{recipient_user_id}
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "20260402_000024"
down_revision: Union[str, None] = "20260402_000023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add new columns (nullable first to allow backfill before unique index)
    op.add_column(
        "notification_logs",
        sa.Column("idempotency_key", sa.String(255), nullable=True),
    )
    op.add_column(
        "notification_logs",
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "notification_logs",
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="3"),
    )

    # 2. Backfill idempotency_key for all existing rows
    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT id, tenant_id, phase, year, month, resource_id, recipient_user_id "
            "FROM notification_logs"
        )
    ).fetchall()

    for row in rows:
        parts = [row.tenant_id, row.phase, str(row.year), str(row.month)]
        if row.resource_id:
            parts.append(row.resource_id)
        parts.append(row.recipient_user_id or "")
        key = "|".join(parts)
        conn.execute(
            text("UPDATE notification_logs SET idempotency_key = :key WHERE id = :id"),
            {"key": key, "id": row.id},
        )

    # 3. Create UNIQUE index on idempotency_key.
    #    Both SQLite and SQL Server allow multiple NULLs in a UNIQUE index so
    #    any future rows without a key will not collide with each other.
    op.create_index(
        "uq_notification_idempotency_key",
        "notification_logs",
        ["idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_notification_idempotency_key", table_name="notification_logs")
    op.drop_column("notification_logs", "max_retries")
    op.drop_column("notification_logs", "retry_count")
    op.drop_column("notification_logs", "idempotency_key")
