"""Approvals tables

Revision ID: 20260202_000004
Revises: 20260202_000003
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '20260202_000004'
down_revision: Union[str, None] = '20260202_000003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Approval instances
    op.create_table(
        'approval_instances',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('subject_type', sa.String(50), nullable=False),
        sa.Column('subject_id', sa.String(36), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_approval_subject', 'approval_instances', ['tenant_id', 'subject_type', 'subject_id'])
    
    # Approval steps
    op.create_table(
        'approval_steps',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('instance_id', sa.String(36), sa.ForeignKey('approval_instances.id'), nullable=False),
        sa.Column('step_order', sa.Integer(), nullable=False),
        sa.Column('step_name', sa.String(50), nullable=False),
        sa.Column('approver_id', sa.String(36), nullable=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('actioned_at', sa.DateTime(), nullable=True),
        sa.Column('actioned_by', sa.String(36), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
    )
    op.create_index('ix_step_instance_order', 'approval_steps', ['instance_id', 'step_order'], unique=True)
    
    # Approval actions (audit trail)
    op.create_table(
        'approval_actions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('instance_id', sa.String(36), sa.ForeignKey('approval_instances.id'), nullable=False),
        sa.Column('step_id', sa.String(36), sa.ForeignKey('approval_steps.id'), nullable=True),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('performed_by', sa.String(36), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_action_instance', 'approval_actions', ['instance_id'])


def downgrade() -> None:
    op.drop_table('approval_actions')
    op.drop_table('approval_steps')
    op.drop_table('approval_instances')
