"""Add graph_department_name to cost_centers

Revision ID: 20260331_000020
Revises: 20260331_000019
Create Date: 2026-03-31

Maps each cost center to its source department name from Microsoft Graph.
Finance/Admin set this field; the sync service uses it to auto-assign
User.cost_center_id when Graph department matches.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260331_000020'
down_revision: Union[str, None] = '20260331_000019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'cost_centers',
        sa.Column('graph_department_name', sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('cost_centers', 'graph_department_name')
