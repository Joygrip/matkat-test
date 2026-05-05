"""Add secondary_role column to users

Revision ID: 20260505_000032
Revises: 20260430_000031
Create Date: 2026-05-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260505_000032"
down_revision: Union[str, None] = "20260430_000031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("secondary_role", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "secondary_role")
