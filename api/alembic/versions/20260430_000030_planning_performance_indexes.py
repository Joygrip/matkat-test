"""Add performance indexes for Resource Planning page

Eliminates sequential scans on the hot query paths:
- demand_lines / supply_lines filtered by period_id (open-period JOIN)
- demand_lines / supply_lines filtered by resource_id or tenant+resource
- resources filtered by cost_center_id (cost-center SQL filter)
- resources filtered by tenant+is_active, or user_id
- periods filtered by tenant+status (open-period filter)
- users filtered by tenant+role or object_id

Revision ID: 20260430_000030
Revises: 20260428_000029
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op

revision: str = "20260430_000030"
down_revision: Union[str, None] = "20260428_000029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # demand_lines
    op.create_index("ix_demand_resource_id", "demand_lines", ["resource_id"])
    op.create_index("ix_demand_project_id", "demand_lines", ["project_id"])
    op.create_index("ix_demand_period_id", "demand_lines", ["period_id"])
    op.create_index("ix_demand_tenant_resource", "demand_lines", ["tenant_id", "resource_id"])
    op.create_index("ix_demand_tenant_project", "demand_lines", ["tenant_id", "project_id"])

    # supply_lines
    op.create_index("ix_supply_resource_id", "supply_lines", ["resource_id"])
    op.create_index("ix_supply_period_id", "supply_lines", ["period_id"])
    op.create_index("ix_supply_tenant_resource", "supply_lines", ["tenant_id", "resource_id"])

    # resources
    op.create_index("ix_resource_cost_center", "resources", ["cost_center_id"])
    op.create_index("ix_resource_tenant_active", "resources", ["tenant_id", "is_active"])
    op.create_index("ix_resource_user_id", "resources", ["user_id"])

    # periods
    op.create_index("ix_period_tenant_status", "periods", ["tenant_id", "status"])

    # users
    op.create_index("ix_user_tenant_role", "users", ["tenant_id", "role"])
    op.create_index("ix_user_object_id", "users", ["object_id"])


def downgrade() -> None:
    op.drop_index("ix_user_object_id", table_name="users")
    op.drop_index("ix_user_tenant_role", table_name="users")
    op.drop_index("ix_period_tenant_status", table_name="periods")
    op.drop_index("ix_resource_user_id", table_name="resources")
    op.drop_index("ix_resource_tenant_active", table_name="resources")
    op.drop_index("ix_resource_cost_center", table_name="resources")
    op.drop_index("ix_supply_tenant_resource", table_name="supply_lines")
    op.drop_index("ix_supply_period_id", table_name="supply_lines")
    op.drop_index("ix_supply_resource_id", table_name="supply_lines")
    op.drop_index("ix_demand_tenant_project", table_name="demand_lines")
    op.drop_index("ix_demand_tenant_resource", table_name="demand_lines")
    op.drop_index("ix_demand_period_id", table_name="demand_lines")
    op.drop_index("ix_demand_project_id", table_name="demand_lines")
    op.drop_index("ix_demand_resource_id", table_name="demand_lines")
