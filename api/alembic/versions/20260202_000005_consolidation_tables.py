"""Consolidation tables - OoP lines and publish snapshots

Revision ID: 20260202_000005
Revises: 20260202_000004
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '20260202_000005'
down_revision: Union[str, None] = '20260202_000004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # OoP lines
    op.create_table(
        'oop_lines',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('period_id', sa.String(36), sa.ForeignKey('periods.id'), nullable=False),
        sa.Column('resource_id', sa.String(36), sa.ForeignKey('resources.id'), nullable=False),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('hours', sa.Integer(), nullable=False),
        sa.Column('hourly_rate', sa.Integer(), nullable=False),
        sa.Column('total_cost', sa.Integer(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_oop_tenant_period', 'oop_lines', ['tenant_id', 'period_id'])
    
    # Publish snapshots
    op.create_table(
        'publish_snapshots',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('period_id', sa.String(36), sa.ForeignKey('periods.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('published_by', sa.String(36), nullable=False),
        sa.Column('published_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_snapshot_tenant_period', 'publish_snapshots', ['tenant_id', 'period_id'])
    
    # Snapshot lines
    op.create_table(
        'publish_snapshot_lines',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('snapshot_id', sa.String(36), sa.ForeignKey('publish_snapshots.id'), nullable=False),
        sa.Column('line_type', sa.String(20), nullable=False),
        sa.Column('project_id', sa.String(36), nullable=True),
        sa.Column('project_name', sa.String(255), nullable=True),
        sa.Column('resource_id', sa.String(36), nullable=True),
        sa.Column('resource_name', sa.String(255), nullable=True),
        sa.Column('placeholder_id', sa.String(36), nullable=True),
        sa.Column('placeholder_name', sa.String(255), nullable=True),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('fte_percent', sa.Integer(), nullable=True),
        sa.Column('hours', sa.Integer(), nullable=True),
        sa.Column('cost', sa.Integer(), nullable=True),
    )
    op.create_index('ix_snapshotline_snapshot', 'publish_snapshot_lines', ['snapshot_id'])


def downgrade() -> None:
    op.drop_table('publish_snapshot_lines')
    op.drop_table('publish_snapshots')
    op.drop_table('oop_lines')
