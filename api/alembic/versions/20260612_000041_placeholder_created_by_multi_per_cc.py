"""Placeholders: add created_by, allow multiple placeholders per cost center.

Revision ID: 20260612_000041
Revises: 20260605_000040
Create Date: 2026-06-12
"""
import sqlalchemy as sa
from alembic import op

revision = '20260612_000041'
down_revision = '20260605_000040'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Batch mode so SQLite recreates the table; on MSSQL it degrades to plain ALTERs.
    with op.batch_alter_table('placeholders', schema=None) as batch_op:
        batch_op.add_column(sa.Column('created_by', sa.String(36), nullable=True))
        batch_op.drop_index('ix_placeholders_tenant_cost_center')
        batch_op.create_index('ix_placeholders_tenant_cost_center', ['tenant_id', 'cost_center_id'], unique=False)


def downgrade() -> None:
    conn = op.get_bind()

    # Restoring the unique index requires one placeholder per (tenant, cost center):
    # keep min(id), repoint demand lines, delete the rest (mirrors migration 000011).
    result = conn.execute(sa.text("""
        SELECT tenant_id, cost_center_id, MIN(id) AS keep_id FROM placeholders
        GROUP BY tenant_id, cost_center_id HAVING COUNT(*) > 1
    """))
    for tenant_id, cost_center_id, keep_id in result.fetchall():
        conn.execute(sa.text("""
            UPDATE demand_lines SET placeholder_id = :keep_id
            WHERE placeholder_id IN (SELECT id FROM placeholders WHERE tenant_id = :tid AND cost_center_id = :ccid AND id != :keep_id)
        """), {"keep_id": keep_id, "tid": tenant_id, "ccid": cost_center_id})
        conn.execute(sa.text("""
            DELETE FROM placeholders WHERE tenant_id = :tid AND cost_center_id = :ccid AND id != :keep_id
        """), {"tid": tenant_id, "ccid": cost_center_id, "keep_id": keep_id})

    with op.batch_alter_table('placeholders', schema=None) as batch_op:
        batch_op.drop_index('ix_placeholders_tenant_cost_center')
        batch_op.create_index('ix_placeholders_tenant_cost_center', ['tenant_id', 'cost_center_id'], unique=True)
        batch_op.drop_column('created_by')
