"""Initial core tables

Revision ID: 20260202_000001
Revises: 
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260202_000001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Departments
    op.create_table(
        'departments',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_departments_tenant_code', 'departments', ['tenant_id', 'code'], unique=True)

    # Cost Centers (ro_user_id FK will be added via application logic since SQLite doesn't support ALTER)
    op.create_table(
        'cost_centers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('department_id', sa.String(36), sa.ForeignKey('departments.id'), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('ro_user_id', sa.String(36), nullable=True),  # FK enforced at app level for SQLite compat
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cost_centers_tenant_code', 'cost_centers', ['tenant_id', 'code'], unique=True)

    # Users
    op.create_table(
        'users',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('object_id', sa.String(36), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('display_name', sa.String(255), nullable=False),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('manager_object_id', sa.String(36), nullable=True),
        sa.Column('department_id', sa.String(36), sa.ForeignKey('departments.id'), nullable=True),
        sa.Column('cost_center_id', sa.String(36), sa.ForeignKey('cost_centers.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_users_tenant_object', 'users', ['tenant_id', 'object_id'], unique=True)

    # NOTE: FK from cost_centers.ro_user_id to users.id is enforced at application level
    # SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we skip it here
    # For SQL Server production, add: ALTER TABLE cost_centers ADD CONSTRAINT fk_cost_centers_ro_user 
    #   FOREIGN KEY (ro_user_id) REFERENCES users(id)

    # Projects
    op.create_table(
        'projects',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('pm_user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('cost_center_id', sa.String(36), sa.ForeignKey('cost_centers.id'), nullable=True),
        sa.Column('start_date', sa.DateTime(), nullable=True),
        sa.Column('end_date', sa.DateTime(), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_projects_tenant_code', 'projects', ['tenant_id', 'code'], unique=True)

    # Resources
    op.create_table(
        'resources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('cost_center_id', sa.String(36), sa.ForeignKey('cost_centers.id'), nullable=False),
        sa.Column('employee_id', sa.String(50), nullable=False),
        sa.Column('display_name', sa.String(255), nullable=False),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('is_external', sa.Boolean(), default=False),
        sa.Column('is_student', sa.Boolean(), default=False),
        sa.Column('is_operator', sa.Boolean(), default=False),
        sa.Column('is_equipment', sa.Boolean(), default=False),
        sa.Column('hourly_cost', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_resources_tenant_employee', 'resources', ['tenant_id', 'employee_id'], unique=True)

    # Periods
    op.create_table(
        'periods',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('locked_at', sa.DateTime(), nullable=True),
        sa.Column('locked_by', sa.String(36), nullable=True),
        sa.Column('lock_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_periods_tenant_year_month', 'periods', ['tenant_id', 'year', 'month'], unique=True)

    # Placeholders
    op.create_table(
        'placeholders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('skill_profile', sa.String(255), nullable=True),
        sa.Column('estimated_cost', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_placeholders_tenant_name', 'placeholders', ['tenant_id', 'name'], unique=True)

    # Settings
    op.create_table(
        'settings',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('key', sa.String(100), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_settings_tenant_key', 'settings', ['tenant_id', 'key'], unique=True)

    # Holidays
    op.create_table(
        'holidays',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('date', sa.DateTime(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('is_company_wide', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_holidays_tenant_date', 'holidays', ['tenant_id', 'date'], unique=True)

    # Audit Logs
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False, index=True),
        sa.Column('user_id', sa.String(36), nullable=True),
        sa.Column('user_email', sa.String(255), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('entity_type', sa.String(100), nullable=False),
        sa.Column('entity_id', sa.String(36), nullable=True),
        sa.Column('old_values', sa.Text(), nullable=True),
        sa.Column('new_values', sa.Text(), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_audit_logs_tenant_created', 'audit_logs', ['tenant_id', 'created_at'])
    op.create_index('ix_audit_logs_entity', 'audit_logs', ['tenant_id', 'entity_type', 'entity_id'])


def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('holidays')
    op.drop_table('settings')
    op.drop_table('placeholders')
    op.drop_table('periods')
    op.drop_table('resources')
    op.drop_table('projects')
    op.drop_table('users')
    op.drop_table('cost_centers')
    op.drop_table('departments')
