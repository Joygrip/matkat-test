"""Add snapshot finance fields for cost reporting

Revision ID: 20260605_000038
Revises: 20260603_000037
Create Date: 2026-06-05

Adds fields required for snapshots to serve as immutable finance reporting artifacts:
- Snapshot header: monthly_fte_cost_used, period_status_at_publish
- Snapshot lines: source_id, project_code, cost_center_code, resource_initials,
  planned_fte_percent, actual_fte_percent, monthly_fte_cost_used,
  planned_cost_cents, actual_cost_cents, approval_status

All columns are nullable so existing snapshots remain unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260605_000038"
down_revision: Union[str, None] = "20260603_000037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("publish_snapshots") as batch_op:
        batch_op.add_column(sa.Column("monthly_fte_cost_used", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("period_status_at_publish", sa.String(10), nullable=True))

    with op.batch_alter_table("publish_snapshot_lines") as batch_op:
        batch_op.add_column(sa.Column("source_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("project_code", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("cost_center_code", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("resource_initials", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("planned_fte_percent", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("actual_fte_percent", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("monthly_fte_cost_used", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("planned_cost_cents", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("actual_cost_cents", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("approval_status", sa.String(20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("publish_snapshot_lines") as batch_op:
        batch_op.drop_column("approval_status")
        batch_op.drop_column("actual_cost_cents")
        batch_op.drop_column("planned_cost_cents")
        batch_op.drop_column("monthly_fte_cost_used")
        batch_op.drop_column("actual_fte_percent")
        batch_op.drop_column("planned_fte_percent")
        batch_op.drop_column("resource_initials")
        batch_op.drop_column("cost_center_code")
        batch_op.drop_column("project_code")
        batch_op.drop_column("source_id")

    with op.batch_alter_table("publish_snapshots") as batch_op:
        batch_op.drop_column("period_status_at_publish")
        batch_op.drop_column("monthly_fte_cost_used")
