"""Add project_external_lines and project_equipment_lines tables

Revision ID: 20260324_000017
Revises: 20260322_000016
Create Date: 2026-03-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260324_000017"
down_revision: Union[str, None] = "20260322_000016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_external_lines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("period_id", sa.String(36), sa.ForeignKey("periods.id"), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("hours", sa.Integer, nullable=False),
        sa.Column("rate", sa.Integer, nullable=False),
        sa.Column("total_cost", sa.Integer, nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_ext_tenant_period", "project_external_lines", ["tenant_id", "period_id"])
    op.create_index("ix_ext_tenant", "project_external_lines", ["tenant_id"])

    op.create_table(
        "project_equipment_lines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("period_id", sa.String(36), sa.ForeignKey("periods.id"), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("cost", sa.Integer, nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_equip_tenant_period", "project_equipment_lines", ["tenant_id", "period_id"])
    op.create_index("ix_equip_tenant", "project_equipment_lines", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_equip_tenant", "project_equipment_lines")
    op.drop_index("ix_equip_tenant_period", "project_equipment_lines")
    op.drop_table("project_equipment_lines")

    op.drop_index("ix_ext_tenant", "project_external_lines")
    op.drop_index("ix_ext_tenant_period", "project_external_lines")
    op.drop_table("project_external_lines")
