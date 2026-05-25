"""Drop unique constraint on cost_centers (tenant_id, code) index

Revision ID: 20260525_000035
Revises: 20260522_000034
Create Date: 2026-05-25
"""
from typing import Sequence, Union
from alembic import op

revision: str = "20260525_000035"
down_revision: Union[str, None] = "20260522_000034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_cost_centers_tenant_code", table_name="cost_centers")
    op.create_index("ix_cost_centers_tenant_code", "cost_centers", ["tenant_id", "code"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_cost_centers_tenant_code", table_name="cost_centers")
    op.create_index("ix_cost_centers_tenant_code", "cost_centers", ["tenant_id", "code"], unique=True)
