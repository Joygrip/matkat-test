"""Add approval_delegates table for absence-based approval delegation.

Managers can grant another user authority to action their pending approval steps.
Admin and Finance can set up delegation for any manager.

Revision ID: 20260331_000022
Revises: 20260331_000021
Create Date: 2026-03-31
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '20260331_000022'
down_revision: Union[str, None] = '20260331_000021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'approval_delegates',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False),
        sa.Column('delegator_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('delegate_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=False),
    )
    op.create_index('ix_approval_delegates_tenant', 'approval_delegates', ['tenant_id'])
    op.create_index(
        'ix_ad_tenant_delegator_delegate',
        'approval_delegates',
        ['tenant_id', 'delegator_id', 'delegate_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_ad_tenant_delegator_delegate', 'approval_delegates')
    op.drop_index('ix_approval_delegates_tenant', 'approval_delegates')
    op.drop_table('approval_delegates')
