"""Merge RO and Director roles into Manager

Revision ID: 20260331_000019
Revises: 20260324_000018
Create Date: 2026-03-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260331_000019'
down_revision: Union[str, None] = '20260324_000018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Migrate existing RO and Director users to the unified Manager role.
    # The two-step approval workflow continues to work via approver_id (identity-based),
    # so this is a safe rename with no functional change to the approval flow.
    op.execute("UPDATE users SET role = 'Manager' WHERE role IN ('RO', 'Director')")


def downgrade() -> None:
    # Cannot automatically reconstruct the original RO vs Director split
    # because that information is no longer stored.
    # A manual data fix would be required if a downgrade is needed.
    pass
