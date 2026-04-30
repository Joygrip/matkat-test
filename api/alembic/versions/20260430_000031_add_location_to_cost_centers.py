"""Add location column to cost_centers

Revision ID: 20260430_000031
Revises: 20260430_000030
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260430_000031"
down_revision: Union[str, None] = "20260430_000030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cost_centers", sa.Column("location", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("cost_centers", "location")
