"""Actuals tables

Revision ID: 20260202_000003
Revises: 20260202_000002
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260202_000003'
down_revision: Union[str, None] = '20260202_000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'actual_lines',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('period_id', sa.String(36), sa.ForeignKey('periods.id'), nullable=False),
        sa.Column('resource_id', sa.String(36), sa.ForeignKey('resources.id'), nullable=False),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('planned_fte_percent', sa.Integer(), nullable=True),
        sa.Column('actual_fte_percent', sa.Integer(), nullable=False),
        sa.Column('employee_signed_at', sa.DateTime(), nullable=True),
        sa.Column('employee_signed_by', sa.String(36), nullable=True),
        sa.Column('is_proxy_signed', sa.Integer(), default=0),
        sa.Column('proxy_sign_reason', sa.Text(), nullable=True),
        sa.Column('ro_approved_at', sa.DateTime(), nullable=True),
        sa.Column('ro_approved_by', sa.String(36), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        # Check constraints
        sa.CheckConstraint(
            '(actual_fte_percent = 0) OR (actual_fte_percent >= 5 AND actual_fte_percent <= 100)',
            name='ck_actual_fte_range'
        ),
        sa.CheckConstraint('actual_fte_percent % 5 = 0', name='ck_actual_fte_step'),
    )
    op.create_index('ix_actual_unique', 'actual_lines', 
                    ['tenant_id', 'resource_id', 'project_id', 'year', 'month'], unique=True)
    op.create_index('ix_actual_tenant_period', 'actual_lines', ['tenant_id', 'year', 'month'])
    op.create_index('ix_actual_resource', 'actual_lines', ['tenant_id', 'resource_id', 'year', 'month'])


def downgrade() -> None:
    op.drop_table('actual_lines')
