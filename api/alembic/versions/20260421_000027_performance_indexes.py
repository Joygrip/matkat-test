"""Add performance indexes for high-frequency filter columns

These indexes cover the most common WHERE patterns under multi-user load:
- demand_lines filtered by project_id (finance cost detail, consolidated costs)
- demand_lines filtered by resource_id (consolidation dashboard, conflict detection)
- actual_lines filtered by project_id (finance actuals dashboard, cost detail)
- project_external_lines filtered by project_id (finance cost detail)
- project_equipment_lines filtered by project_id (finance cost detail)

approval_instances already has ix_approval_subject on (tenant_id, subject_type, subject_id).
supply_lines already has ix_supply_unique on (tenant_id, resource_id, year, month).
actual_lines already has ix_actual_resource on (tenant_id, resource_id, year, month).

Revision ID: 20260421_000027
Revises: 20260408_000026
Create Date: 2026-04-21
"""
from typing import Sequence, Union
from alembic import op

revision: str = "20260421_000027"
down_revision: Union[str, None] = "20260408_000026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_demand_project", "demand_lines", ["tenant_id", "project_id"])
    op.create_index("ix_demand_resource", "demand_lines", ["tenant_id", "resource_id"])
    op.create_index("ix_actual_project", "actual_lines", ["tenant_id", "project_id"])
    op.create_index("ix_ext_project", "project_external_lines", ["tenant_id", "project_id"])
    op.create_index("ix_equip_project", "project_equipment_lines", ["tenant_id", "project_id"])


def downgrade() -> None:
    op.drop_index("ix_equip_project", table_name="project_equipment_lines")
    op.drop_index("ix_ext_project", table_name="project_external_lines")
    op.drop_index("ix_actual_project", table_name="actual_lines")
    op.drop_index("ix_demand_resource", table_name="demand_lines")
    op.drop_index("ix_demand_project", table_name="demand_lines")
