"""Add country column to users table

Revision ID: 20260522_000034
Revises: 20260521_000033
Create Date: 2026-05-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260522_000034"
down_revision: Union[str, None] = "20260521_000033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("country", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "country")
