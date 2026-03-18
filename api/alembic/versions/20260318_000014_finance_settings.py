"""Add finance_settings table

Revision ID: 20260318_000014
Revises: 20260303_000013
Create Date: 2026-03-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260318_000014"
down_revision: Union[str, None] = "20260303_000013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "finance_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("setting_key", sa.String(100), nullable=False),
        sa.Column("setting_value", sa.String(500), nullable=False),
        sa.Column("updated_by", sa.String(36), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_finance_settings_tenant_key",
        "finance_settings",
        ["tenant_id", "setting_key"],
        unique=True,
    )
    op.create_index(
        "ix_finance_settings_tenant_id",
        "finance_settings",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_finance_settings_tenant_key", table_name="finance_settings")
    op.drop_index("ix_finance_settings_tenant_id", table_name="finance_settings")
    op.drop_table("finance_settings")
