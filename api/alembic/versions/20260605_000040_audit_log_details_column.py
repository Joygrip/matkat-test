"""Add details column to audit_logs for enriched business context.

Revision ID: 20260605_000040
Revises: 20260605_000039
Create Date: 2026-06-05
"""
import sqlalchemy as sa
from alembic import op

revision = '20260605_000040'
down_revision = '20260605_000039'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('audit_logs', sa.Column('details', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('audit_logs', 'details')
