"""Remove departments; cost centers only; add director_user_id to cost_centers

Revision ID: 20260303_000013
Revises: 20260211_000012
Create Date: 2026-03-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260303_000013"
down_revision: Union[str, None] = "20260211_000012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1) Add director_user_id to cost_centers (nullable)
    with op.batch_alter_table("cost_centers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("director_user_id", sa.String(36), nullable=True))

    # 2) Backfill: for each cost_center with department_id, set director_user_id to one Director in that department
    if conn.dialect.name == "sqlite":
        result = conn.execute(
            sa.text("""
                SELECT c.id, c.department_id FROM cost_centers c
                WHERE c.department_id IS NOT NULL
            """)
        )
        for row in result:
            cc_id, dept_id = row[0], row[1]
            director = conn.execute(
                sa.text("""
                    SELECT id FROM users
                    WHERE department_id = :dept_id AND role = 'Director' AND is_active = 1
                    LIMIT 1
                """),
                {"dept_id": dept_id},
            ).fetchone()
            if director:
                conn.execute(
                    sa.text("UPDATE cost_centers SET director_user_id = :uid WHERE id = :cc_id"),
                    {"uid": director[0], "cc_id": cc_id},
                )

    # 3) Drop FK constraint then department_id from users
    with op.batch_alter_table("users", schema=None) as batch_op:
        # Drop all FK constraints on department_id (SQL Server auto-names them)
        conn = op.get_bind()
        result = conn.execute(sa.text("""
            SELECT name FROM sys.foreign_keys
            WHERE parent_object_id = OBJECT_ID('users')
            AND COL_NAME(parent_object_id, parent_column_id) = 'department_id'
        """))
        for row in result:
            batch_op.drop_constraint(row[0], type_="foreignkey")
        batch_op.drop_column("department_id")

    # 4) Drop department_id from placeholders
    with op.batch_alter_table("placeholders", schema=None) as batch_op:
        batch_op.drop_column("department_id")

    # 5) Drop department_id from cost_centers
    with op.batch_alter_table("cost_centers", schema=None) as batch_op:
        batch_op.drop_column("department_id")

    # 6) Drop departments table
    op.drop_table("departments")


def downgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False, index=True),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_departments_tenant_code", "departments", ["tenant_id", "code"], unique=True)

    with op.batch_alter_table("cost_centers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("department_id", sa.String(36), nullable=True))
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("department_id", sa.String(36), nullable=True))
    with op.batch_alter_table("placeholders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("department_id", sa.String(36), nullable=True))

    with op.batch_alter_table("cost_centers", schema=None) as batch_op:
        batch_op.drop_column("director_user_id")
