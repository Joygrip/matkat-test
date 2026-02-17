"""Replace resource boolean flags with resource_type enum

Revision ID: 20260211_000010
Revises: 20260211_000009
Create Date: 2026-02-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260211_000010'
down_revision: Union[str, None] = '20260211_000009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Store as string for SQLite compatibility (Employee, External, Student, OOP)
RESOURCE_TYPE_ENUM_VALUES = ('Employee', 'External', 'Student', 'OOP')


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c['name'] for c in insp.get_columns('resources')]
    has_resource_type = 'resource_type' in cols
    has_old_flags = 'is_external' in cols

    if not has_resource_type:
        op.add_column(
            'resources',
            sa.Column('resource_type', sa.String(20), nullable=True),
        )
        if conn.dialect.name == 'sqlite':
            conn.execute(sa.text("""
                UPDATE resources SET resource_type = CASE
                    WHEN is_operator = 1 OR is_equipment = 1 THEN 'OOP'
                    WHEN is_external = 1 THEN 'External'
                    WHEN is_student = 1 THEN 'Student'
                    ELSE 'Employee'
                END
            """))
        else:
            conn.execute(sa.text("""
                UPDATE resources SET resource_type = CASE
                    WHEN is_operator = true OR is_equipment = true THEN 'OOP'
                    WHEN is_external = true THEN 'External'
                    WHEN is_student = true THEN 'Student'
                    ELSE 'Employee'
                END
            """))

    if has_old_flags:
        # SQLite: drop leftover temp table from previous failed run if any
        if conn.dialect.name == 'sqlite':
            conn.execute(sa.text("DROP TABLE IF EXISTS _alembic_tmp_resources"))
        # Ensure no NULLs (for any future batch or strict checks)
        conn.execute(sa.text("UPDATE resources SET resource_type = 'Employee' WHERE resource_type IS NULL"))
        with op.batch_alter_table('resources', schema=None) as batch_op:
            if has_resource_type:
                batch_op.alter_column(
                    'resource_type',
                    existing_type=sa.String(20),
                    nullable=False,
                )
            batch_op.drop_column('is_equipment')
            batch_op.drop_column('is_operator')
            batch_op.drop_column('is_student')
            batch_op.drop_column('is_external')


def downgrade() -> None:
    op.add_column('resources', sa.Column('is_external', sa.Boolean(), nullable=True, server_default='0'))
    op.add_column('resources', sa.Column('is_student', sa.Boolean(), nullable=True, server_default='0'))
    op.add_column('resources', sa.Column('is_operator', sa.Boolean(), nullable=True, server_default='0'))
    op.add_column('resources', sa.Column('is_equipment', sa.Boolean(), nullable=True, server_default='0'))

    conn = op.get_bind()
    if conn.dialect.name == 'sqlite':
        conn.execute(sa.text("""
            UPDATE resources SET
                is_external = CASE WHEN resource_type = 'External' THEN 1 ELSE 0 END,
                is_student = CASE WHEN resource_type = 'Student' THEN 1 ELSE 0 END,
                is_operator = CASE WHEN resource_type = 'OOP' THEN 1 ELSE 0 END,
                is_equipment = CASE WHEN resource_type = 'OOP' THEN 1 ELSE 0 END
        """))
    else:
        conn.execute(sa.text("""
            UPDATE resources SET
                is_external = (resource_type = 'External'),
                is_student = (resource_type = 'Student'),
                is_operator = (resource_type = 'OOP'),
                is_equipment = (resource_type = 'OOP')
        """))

    op.alter_column('resources', 'is_external', nullable=False, server_default='0')
    op.alter_column('resources', 'is_student', nullable=False, server_default='0')
    op.alter_column('resources', 'is_operator', nullable=False, server_default='0')
    op.alter_column('resources', 'is_equipment', nullable=False, server_default='0')

    op.drop_column('resources', 'resource_type')
