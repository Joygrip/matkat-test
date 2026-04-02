"""Add notes column to project_external_lines

Revision ID: 20260402_000023
Revises: 20260331_000022
Create Date: 2026-04-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260402_000023"
down_revision: Union[str, None] = "20260331_000022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.add_column(
            sa.Column("notes", sa.Text, nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.drop_column("notes")
