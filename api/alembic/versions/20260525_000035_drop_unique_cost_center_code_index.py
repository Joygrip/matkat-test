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


def upgrade():
    # Drop unique index if it exists (may not exist on all environments)
    op.execute("""
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cost_centers_tenant_code' AND object_id = OBJECT_ID('cost_centers'))
            DROP INDEX ix_cost_centers_tenant_code ON cost_centers
    """)
    # Create non-unique index
    op.execute("""
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cost_centers_tenant_code' AND object_id = OBJECT_ID('cost_centers'))
            CREATE INDEX ix_cost_centers_tenant_code ON cost_centers (tenant_id, code)
    """)


def downgrade():
    op.execute("""
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cost_centers_tenant_code' AND object_id = OBJECT_ID('cost_centers'))
            DROP INDEX ix_cost_centers_tenant_code ON cost_centers
    """)
    op.execute("""
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_cost_centers_tenant_code' AND object_id = OBJECT_ID('cost_centers'))
            CREATE UNIQUE INDEX ix_cost_centers_tenant_code ON cost_centers (tenant_id, code)
    """)