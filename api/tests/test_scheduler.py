"""
Tests for scheduler._get_open_period and notification_schedules._current_open_period.

These functions must prefer the nearest current/future open period and only fall
back to the most-recent historical open period when no current/future one exists.
"""
import uuid
from datetime import date

import pytest

from api.app.models.core import Period, PeriodStatus
from api.app.services.scheduler import _get_open_period
from api.app.routers.notification_schedules import _current_open_period

TENANT = "test-tenant-001"


def _period(year: int, month: int, status: PeriodStatus = PeriodStatus.OPEN) -> Period:
    return Period(
        id=str(uuid.uuid4()),
        tenant_id=TENANT,
        year=year,
        month=month,
        monthly_fte_cost=99000,
        status=status,
    )


# ── _get_open_period ──────────────────────────────────────────────────────────

class TestGetOpenPeriod:
    def test_prefers_current_month_over_historical(self, db):
        today = date.today()
        db.add_all([
            _period(2024, 1),                        # historical open
            _period(today.year, today.month),        # current open
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (today.year, today.month)

    def test_prefers_earliest_future_over_historical(self, db):
        today = date.today()
        future_year = today.year + 1
        db.add_all([
            _period(2024, 6),          # historical open
            _period(future_year, 3),   # future open
            _period(future_year, 7),   # further future open
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (future_year, 3)  # earliest future

    def test_falls_back_to_most_recent_when_all_historical(self, db):
        db.add_all([
            _period(2024, 1),
            _period(2024, 6),
            _period(2025, 3),
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2025, 3)  # most recent historical

    def test_returns_none_when_no_open_periods(self, db):
        db.add(_period(2024, 1, PeriodStatus.LOCKED))
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result is None

    def test_returns_none_for_tenant_with_no_periods(self, db):
        result = _get_open_period(db, "nonexistent-tenant")
        assert result is None

    def test_ignores_other_tenants(self, db):
        today = date.today()
        db.add_all([
            _period(2024, 1),                              # own tenant, historical
            Period(
                id=str(uuid.uuid4()),
                tenant_id="other-tenant",
                year=today.year,
                month=today.month,
                monthly_fte_cost=99000,
                status=PeriodStatus.OPEN,
            ),
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        # Falls back to most-recent historical because the current-month period
        # belongs to a different tenant.
        assert result == (2024, 1)

    def test_locked_historical_period_not_returned(self, db):
        today = date.today()
        db.add_all([
            _period(2024, 1, PeriodStatus.LOCKED),   # locked, ignored
            _period(today.year, today.month),         # open, current
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (today.year, today.month)


# ── _current_open_period (notification_schedules) ─────────────────────────────

class TestCurrentOpenPeriod:
    def test_prefers_current_month_over_historical(self, db):
        today = date.today()
        db.add_all([
            _period(2024, 3),
            _period(today.year, today.month),
        ])
        db.commit()

        result = _current_open_period(db, TENANT)
        assert result == (today.year, today.month)

    def test_falls_back_to_most_recent_when_all_historical(self, db):
        db.add_all([
            _period(2024, 1),
            _period(2025, 12),
        ])
        db.commit()

        result = _current_open_period(db, TENANT)
        assert result == (2025, 12)

    def test_falls_back_to_today_when_no_open_periods(self, db):
        today = date.today()
        db.add(_period(2024, 1, PeriodStatus.LOCKED))
        db.commit()

        result = _current_open_period(db, TENANT)
        assert result == (today.year, today.month)
