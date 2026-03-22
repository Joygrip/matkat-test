"""Add reporting_cache and manager_overrides tables

Revision ID: 20260322_000015
Revises: 20260318_000014
Create Date: 2026-03-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260322_000015"
down_revision: Union[str, None] = "20260318_000014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reporting_cache",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("employee_object_id", sa.String(36), nullable=False),
        sa.Column("manager_object_id", sa.String(36), nullable=False),
        sa.Column("depth", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_rc_tenant_manager",
        "reporting_cache",
        ["tenant_id", "manager_object_id"],
    )
    op.create_index(
        "ix_rc_tenant_employee_manager",
        "reporting_cache",
        ["tenant_id", "employee_object_id", "manager_object_id"],
        unique=True,
    )

    op.create_table(
        "manager_overrides",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("employee_object_id", sa.String(36), nullable=False),
        sa.Column("manager_object_id", sa.String(36), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
    )
    op.create_index(
        "ix_mo_tenant_id",
        "manager_overrides",
        ["tenant_id"],
    )
    op.create_index(
        "ix_mo_tenant_employee_manager",
        "manager_overrides",
        ["tenant_id", "employee_object_id", "manager_object_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_rc_tenant_manager", table_name="reporting_cache")
    op.drop_index("ix_rc_tenant_employee_manager", table_name="reporting_cache")
    op.drop_table("reporting_cache")

    op.drop_index("ix_mo_tenant_id", table_name="manager_overrides")
    op.drop_index("ix_mo_tenant_employee_manager", table_name="manager_overrides")
    op.drop_table("manager_overrides")
