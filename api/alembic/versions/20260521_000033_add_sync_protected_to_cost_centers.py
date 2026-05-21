"""Add sync_protected column to cost_centers; protect QC DK and QC PL

Revision ID: 20260521_000033
Revises: 20260505_000032
Create Date: 2026-05-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260521_000033"
down_revision: Union[str, None] = "20260505_000032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cost_centers",
        sa.Column("sync_protected", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # QC DK and QC PL are manually split sub-CCs with no unique Graph department name.
    # Sync must never reassign their users.
    op.execute(
        sa.text("UPDATE cost_centers SET sync_protected = 1 WHERE name IN ('QC DK', 'QC PL')")
    )


def downgrade() -> None:
    op.drop_column("cost_centers", "sync_protected")
