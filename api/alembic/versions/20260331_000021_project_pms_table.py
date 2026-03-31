"""Replace projects.pm_user_id with project_pms many-to-many table

Revision ID: 20260331_000021
Revises: 20260331_000020
Create Date: 2026-03-31

Allows multiple PMs to be assigned to the same project.
Migrates existing pm_user_id values into the new association table,
then drops the pm_user_id column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260331_000021'
down_revision: Union[str, None] = '20260331_000020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the project_pms association table
    op.create_table(
        'project_pms',
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('tenant_id', sa.String(36), nullable=False),
    )
    op.create_index('ix_project_pms_tenant', 'project_pms', ['tenant_id'])

    # Migrate existing pm_user_id data
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, tenant_id, pm_user_id FROM projects WHERE pm_user_id IS NOT NULL")
    ).fetchall()
    for row in rows:
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO project_pms (project_id, user_id, tenant_id) VALUES (:pid, :uid, :tid)"
            ),
            {"pid": row[0], "uid": row[2], "tid": row[1]},
        )

    # Drop the old column
    with op.batch_alter_table('projects') as batch_op:
        batch_op.drop_column('pm_user_id')


def downgrade() -> None:
    with op.batch_alter_table('projects') as batch_op:
        batch_op.add_column(sa.Column('pm_user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True))

    # Restore one PM per project (take the first one from project_pms)
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT project_id, user_id FROM project_pms")
    ).fetchall()
    seen = set()
    for row in rows:
        if row[0] not in seen:
            conn.execute(
                sa.text("UPDATE projects SET pm_user_id = :uid WHERE id = :pid"),
                {"uid": row[1], "pid": row[0]},
            )
            seen.add(row[0])

    op.drop_index('ix_project_pms_tenant', 'project_pms')
    op.drop_table('project_pms')
