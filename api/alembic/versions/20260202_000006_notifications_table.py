"""Notifications table

Revision ID: 20260202_000006
Revises: 20260202_000005
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '20260202_000006'
down_revision: Union[str, None] = '20260202_000005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'notification_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('phase', sa.String(20), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('recipient_user_id', sa.String(36), nullable=True),
        sa.Column('recipient_email', sa.String(255), nullable=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('run_id', sa.String(36), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_notification_run', 'notification_logs', 
                   ['tenant_id', 'phase', 'year', 'month', 'run_id'])


def downgrade() -> None:
    op.drop_table('notification_logs')
