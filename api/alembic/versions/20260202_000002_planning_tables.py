"""Planning tables - DemandLine and SupplyLine

Revision ID: 20260202_000002
Revises: 20260202_000001
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260202_000002'
down_revision: Union[str, None] = '20260202_000001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DemandLine table
    op.create_table(
        'demand_lines',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('period_id', sa.String(36), sa.ForeignKey('periods.id'), nullable=False),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('resource_id', sa.String(36), sa.ForeignKey('resources.id'), nullable=True),
        sa.Column('placeholder_id', sa.String(36), sa.ForeignKey('placeholders.id'), nullable=True),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('fte_percent', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        # Check constraints (enforced at API level for SQLite compatibility)
        sa.CheckConstraint('fte_percent >= 5 AND fte_percent <= 100', name='ck_demand_fte_range'),
        sa.CheckConstraint('fte_percent % 5 = 0', name='ck_demand_fte_step'),
        sa.CheckConstraint(
            '(resource_id IS NOT NULL AND placeholder_id IS NULL) OR '
            '(resource_id IS NULL AND placeholder_id IS NOT NULL)',
            name='ck_demand_xor'
        ),
    )
    op.create_index('ix_demand_tenant_period', 'demand_lines', ['tenant_id', 'year', 'month'])
    
    # Note: Filtered unique indexes not supported in SQLite
    # For SQL Server in production, add:
    # CREATE UNIQUE NONCLUSTERED INDEX ix_demand_resource_unique 
    #   ON demand_lines (tenant_id, project_id, resource_id, year, month) 
    #   WHERE resource_id IS NOT NULL;
    # CREATE UNIQUE NONCLUSTERED INDEX ix_demand_placeholder_unique 
    #   ON demand_lines (tenant_id, project_id, placeholder_id, year, month) 
    #   WHERE placeholder_id IS NOT NULL;
    
    # SupplyLine table
    op.create_table(
        'supply_lines',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('period_id', sa.String(36), sa.ForeignKey('periods.id'), nullable=False),
        sa.Column('resource_id', sa.String(36), sa.ForeignKey('resources.id'), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('fte_percent', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        # Check constraints
        sa.CheckConstraint('fte_percent >= 5 AND fte_percent <= 100', name='ck_supply_fte_range'),
        sa.CheckConstraint('fte_percent % 5 = 0', name='ck_supply_fte_step'),
    )
    op.create_index('ix_supply_unique', 'supply_lines', ['tenant_id', 'resource_id', 'year', 'month'], unique=True)
    op.create_index('ix_supply_tenant_period', 'supply_lines', ['tenant_id', 'year', 'month'])


def downgrade() -> None:
    op.drop_table('supply_lines')
    op.drop_table('demand_lines')
