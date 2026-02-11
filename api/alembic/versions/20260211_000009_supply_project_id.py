"""Add optional project_id to supply_lines

Revision ID: 20260211_000009
Revises: 20260211_000008
Create Date: 2026-02-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260211_000009'
down_revision: Union[str, None] = '20260211_000008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add project_id column (FK enforced at app level for SQLite compat)
    op.add_column('supply_lines', sa.Column('project_id', sa.String(36), nullable=True))

    # Drop old unique index and create new one including project_id
    op.drop_index('ix_supply_unique', table_name='supply_lines')
    op.create_index(
        'ix_supply_unique',
        'supply_lines',
        ['tenant_id', 'resource_id', 'project_id', 'year', 'month'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_supply_unique', table_name='supply_lines')
    op.create_index(
        'ix_supply_unique',
        'supply_lines',
        ['tenant_id', 'resource_id', 'year', 'month'],
        unique=True,
    )
    op.drop_column('supply_lines', 'project_id')
