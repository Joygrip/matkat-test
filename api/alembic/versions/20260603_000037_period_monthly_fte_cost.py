"""Add period-level monthly_fte_cost with backfill

Revision ID: 20260603_000037
Revises: 20260527_000036
Create Date: 2026-06-03

Historical limitation:
Existing historical periods are initialized with the current configured/default
rate because no prior monthly rate history exists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260603_000037"
down_revision: Union[str, None] = "20260527_000036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("periods") as batch_op:
        batch_op.add_column(sa.Column("monthly_fte_cost", sa.Integer(), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE periods
            SET monthly_fte_cost = COALESCE(
                (
                    SELECT CAST(fs.setting_value AS INTEGER)
                    FROM finance_settings fs
                    WHERE fs.tenant_id = periods.tenant_id
                      AND fs.setting_key = 'monthly_fte_cost'
                ),
                99000
            )
            WHERE monthly_fte_cost IS NULL
            """
        )
    )

    with op.batch_alter_table("periods") as batch_op:
        batch_op.alter_column(
            "monthly_fte_cost",
            existing_type=sa.Integer(),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("periods") as batch_op:
        batch_op.drop_column("monthly_fte_cost")
