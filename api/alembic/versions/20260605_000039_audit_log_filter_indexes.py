"""Add audit log filter indexes for action and user_email.

Revision ID: 20260605_000039
Revises: 20260605_000038
Create Date: 2026-06-05
"""
from alembic import op

revision = '20260605_000039'
down_revision = '20260605_000038'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index('ix_audit_logs_action', 'audit_logs', ['tenant_id', 'action'])
    op.create_index('ix_audit_logs_user_email', 'audit_logs', ['tenant_id', 'user_email'])


def downgrade() -> None:
    op.drop_index('ix_audit_logs_action', table_name='audit_logs')
    op.drop_index('ix_audit_logs_user_email', table_name='audit_logs')
