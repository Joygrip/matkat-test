"""Add approval_rejection notification schedule

Extends the notification_type enum to include 'approval_rejection' and inserts
a default schedule record.  The rejection notification is event-driven — the
scheduler skips it; the record exists only to give admins an on/off toggle and
excluded_emails control.

Revision ID: 20260527_000036
Revises: 20260525_000035
Create Date: 2026-05-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260527_000036"
down_revision: Union[str, None] = "20260525_000035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TENANT_ID  = "3c356d1d-7740-4a57-921a-948c6a97c210"
_RECORD_ID  = "a8f2e1d0-c3b4-4a56-9e7f-0123456789ab"
_ALL_VALUES = (
    "conflict_alerts", "missing_actuals", "planning_reminder",
    "approval_reminder", "approval_rejection",
)


def upgrade() -> None:
    # Widen the column
    op.execute(sa.text(
        "ALTER TABLE notification_schedules ALTER COLUMN notification_type VARCHAR(50) NOT NULL"
    ))

    # Insert the default approval_rejection schedule if not already present.
    # CURRENT_TIMESTAMP is supported by both SQLite and SQL Server.
    op.execute(sa.text(f"""
        INSERT INTO notification_schedules
            (id, tenant_id, notification_type, trigger_type, trigger_value,
             time_of_day, is_active,
             notify_pm, notify_manager, notify_finance, notify_employee,
             created_at, updated_at, created_by)
        SELECT
            '{_RECORD_ID}',
            '{_TENANT_ID}',
            'approval_rejection',
            'day_of_month',
            1,
            '08:00',
            1,
            0,
            1,
            0,
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            'system'
        WHERE NOT EXISTS (
            SELECT 1 FROM notification_schedules
            WHERE notification_type = 'approval_rejection'
              AND tenant_id = '{_TENANT_ID}'
        )
    """))


def downgrade() -> None:
    op.execute(sa.text(
        "DELETE FROM notification_schedules WHERE notification_type = 'approval_rejection'"
    ))
    op.execute(sa.text(
        "ALTER TABLE notification_schedules ALTER COLUMN notification_type VARCHAR(17) NOT NULL"
    ))
