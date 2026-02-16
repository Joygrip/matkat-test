"""add audit_logs table

Revision ID: 20260211_000007
Revises: 20260202_000006
Create Date: 2026-02-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260211_000007'
down_revision: Union[str, None] = '20260202_000006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # audit_logs table already created in initial migration; nothing to do here
    pass

def downgrade() -> None:
    # audit_logs table already created in initial migration; nothing to do here
    pass
