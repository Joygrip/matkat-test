"""Add resource_id to project_external_lines

Revision ID: 20260324_000018
Revises: 20260324_000017
Create Date: 2026-03-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260324_000018"
down_revision: Union[str, None] = "20260324_000017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.add_column(
            sa.Column("resource_id", sa.String(36), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table("project_external_lines") as batch_op:
        batch_op.drop_column("resource_id")
