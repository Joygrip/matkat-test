"""One placeholder per cost center; cost_center_id required

Revision ID: 20260211_000011
Revises: 20260211_000010
Create Date: 2026-02-11

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260211_000011'
down_revision: Union[str, None] = '20260211_000010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1) Backfill: for each cost center with no placeholder, insert one
    result = conn.execute(sa.text("""
        SELECT c.id, c.tenant_id, c.name FROM cost_centers c
        WHERE NOT EXISTS (SELECT 1 FROM placeholders p WHERE p.cost_center_id = c.id)
    """))
    for row in result:
        cc_id, tenant_id, cc_name = row[0], row[1], row[2]
        ph_id = str(uuid.uuid4())
        name = f"Placeholder: {cc_name}"
        if conn.dialect.name == 'sqlite':
            conn.execute(sa.text("""
                INSERT INTO placeholders (id, tenant_id, cost_center_id, name, description, skill_profile, estimated_cost, is_active, created_at, updated_at)
                VALUES (:id, :tenant_id, :cost_center_id, :name, NULL, NULL, NULL, 1, datetime('now'), datetime('now'))
            """), {"id": ph_id, "tenant_id": tenant_id, "cost_center_id": cc_id, "name": name})
        else:
            conn.execute(sa.text("""
                INSERT INTO placeholders (id, tenant_id, cost_center_id, name, description, skill_profile, estimated_cost, is_active, created_at, updated_at)
                VALUES (:id, :tenant_id, :cost_center_id, :name, NULL, NULL, NULL, 1, GETDATE(), GETDATE())
            """), {"id": ph_id, "tenant_id": tenant_id, "cost_center_id": cc_id, "name": name})

    # 2) Assign placeholders with null cost_center_id to first cost center of their tenant
    if conn.dialect.name == 'sqlite':
        conn.execute(sa.text("""
            UPDATE placeholders SET cost_center_id = (
                SELECT id FROM cost_centers WHERE cost_centers.tenant_id = placeholders.tenant_id LIMIT 1
            ) WHERE cost_center_id IS NULL
        """))
    else:
        conn.execute(sa.text("""
            UPDATE placeholders SET cost_center_id = (
                SELECT TOP 1 id FROM cost_centers WHERE cost_centers.tenant_id = placeholders.tenant_id
            ) WHERE cost_center_id IS NULL
        """))

    # 3) Deduplicate: for each (tenant_id, cost_center_id) keep one placeholder (min id), point demand_lines to it, delete others
    result = conn.execute(sa.text("""
        SELECT tenant_id, cost_center_id, MIN(id) AS keep_id FROM placeholders
        GROUP BY tenant_id, cost_center_id HAVING COUNT(*) > 1
    """))
    dup_rows = result.fetchall()
    for row in dup_rows:
        tenant_id, cost_center_id, keep_id = row[0], row[1], row[2]
        conn.execute(sa.text("""
            UPDATE demand_lines SET placeholder_id = :keep_id
            WHERE placeholder_id IN (SELECT id FROM placeholders WHERE tenant_id = :tid AND cost_center_id = :ccid AND id != :keep_id)
        """), {"keep_id": keep_id, "tid": tenant_id, "ccid": cost_center_id})
        conn.execute(sa.text("""
            DELETE FROM placeholders WHERE tenant_id = :tid AND cost_center_id = :ccid AND id != :keep_id
        """), {"tid": tenant_id, "ccid": cost_center_id, "keep_id": keep_id})

    # 4) Drop old index, add new unique index
    op.drop_index('ix_placeholders_tenant_name_dept', table_name='placeholders')

    # 5) Make cost_center_id NOT NULL and add unique - use batch for SQLite (recreates table)
    with op.batch_alter_table('placeholders', schema=None) as batch_op:
        batch_op.alter_column(
            'cost_center_id',
            existing_type=sa.String(36),
            nullable=False,
        )
        batch_op.create_index('ix_placeholders_tenant_cost_center', ['tenant_id', 'cost_center_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_placeholders_tenant_cost_center', table_name='placeholders')
    with op.batch_alter_table('placeholders', schema=None) as batch_op:
        batch_op.alter_column(
            'cost_center_id',
            existing_type=sa.String(36),
            nullable=True,
        )
    op.create_index(
        'ix_placeholders_tenant_name_dept',
        'placeholders',
        ['tenant_id', 'name', 'department_id'],
        unique=True,
    )
