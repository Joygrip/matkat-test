"""Replace hours/rate/total_cost with flat cost on project_external_lines

Revision ID: 20260408_000026
Revises: 20260402_000025
Create Date: 2026-04-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260408_000026"
down_revision: Union[str, None] = "20260402_000025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("project_external_lines") as batch_op:
        # Add new flat cost column, temporarily nullable for data migration
        batch_op.add_column(sa.Column("cost", sa.Integer, nullable=True))

    # Migrate existing data: cost = total_cost (already stored in cents)
    op.execute("UPDATE project_external_lines SET cost = total_cost")

    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.alter_column("cost", existing_type=sa.Integer, nullable=False)
        batch_op.drop_column("hours")
        batch_op.drop_column("rate")
        batch_op.drop_column("total_cost")


def downgrade() -> None:
    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.add_column(sa.Column("hours", sa.Integer, nullable=True))
        batch_op.add_column(sa.Column("rate", sa.Integer, nullable=True))
        batch_op.add_column(sa.Column("total_cost", sa.Integer, nullable=True))

    # Restore hours/rate/total_cost from cost (set hours=1, rate=cost as best approximation)
    op.execute("UPDATE project_external_lines SET hours = 1, rate = cost, total_cost = cost")

    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.alter_column("hours", existing_type=sa.Integer, nullable=False)
        batch_op.alter_column("rate", existing_type=sa.Integer, nullable=False)
        batch_op.alter_column("total_cost", existing_type=sa.Integer, nullable=False)
        batch_op.drop_column("cost")