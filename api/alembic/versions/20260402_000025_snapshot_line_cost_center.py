"""Add cost_center_id and cost_center_name to publish_snapshot_lines

Revision ID: 20260402_000025
Revises: 20260402_000024
Create Date: 2026-04-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260402_000025"
down_revision: Union[str, None] = "20260402_000024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("publish_snapshot_lines") as batch_op:
        batch_op.add_column(sa.Column("cost_center_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("cost_center_name", sa.String(255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("publish_snapshot_lines") as batch_op:
        batch_op.drop_column("cost_center_name")
        batch_op.drop_column("cost_center_id")
