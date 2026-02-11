"""Add department_id and cost_center_id to placeholders

Revision ID: 20260211_000008
Revises: 20260211_000007_audit_logs_table
Create Date: 2026-02-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260211_000008'
down_revision: Union[str, None] = '20260211_000007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add department_id column (FK enforced at app level for SQLite compat)
    op.add_column('placeholders', sa.Column('department_id', sa.String(36), nullable=True))

    # Add cost_center_id column (FK enforced at app level for SQLite compat)
    op.add_column('placeholders', sa.Column('cost_center_id', sa.String(36), nullable=True))

    # Replace old unique index with new one that includes department_id
    op.drop_index('ix_placeholders_tenant_name', table_name='placeholders')
    op.create_index(
        'ix_placeholders_tenant_name_dept',
        'placeholders',
        ['tenant_id', 'name', 'department_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_placeholders_tenant_name_dept', table_name='placeholders')
    op.create_index(
        'ix_placeholders_tenant_name',
        'placeholders',
        ['tenant_id', 'name'],
        unique=True,
    )
    op.drop_column('placeholders', 'cost_center_id')
    op.drop_column('placeholders', 'department_id')
