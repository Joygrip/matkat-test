"""Add initials to resources

Revision ID: 20260211_000012
Revises: 20260211_000011
Create Date: 2026-02-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '20260211_000012'
down_revision: Union[str, None] = '20260211_000011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'resources',
        sa.Column('initials', sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('resources', 'initials')
