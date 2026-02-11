"""add audit_logs table

Revision ID: 20260211_000007_audit_logs_table
Revises: 20260202_000006_notifications_table
Create Date: 2026-02-11
"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('user_email', sa.String(length=255), nullable=False),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('entity', sa.String(length=64), nullable=False),
        sa.Column('entity_id', sa.String(length=36), nullable=False),
        sa.Column('before', sa.Text(), nullable=True),
        sa.Column('after', sa.Text(), nullable=True),
    )

def downgrade():
    op.drop_table('audit_logs')
