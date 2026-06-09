"""
Tests for scheduler._get_open_period and notification_schedules._current_open_period.

Product rule: OPEN status defines the active planning window.
The EARLIEST open period by year/month is always the active period.
Today's calendar date does not influence which open period is selected.
Historical years are expected to be LOCKED, which automatically excludes them.
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
    def test_returns_earliest_open_period(self, db):
        """Earliest open period is returned regardless of today's date."""
        db.add_all([_period(2026, 5), _period(2026, 6), _period(2026, 7)])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2026, 5)

    def test_may_returned_when_today_is_june(self, db):
        """Classic regression: May open, June open, today is June → must return May."""
        # Both May and June are open. The correct answer is May (earliest).
        # The previous 'nearest current/future' logic wrongly returned June.
        db.add_all([_period(2026, 5), _period(2026, 6)])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2026, 5)

    def test_ignores_locked_periods(self, db):
        db.add_all([
            _period(2026, 4, PeriodStatus.LOCKED),
            _period(2026, 5),
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2026, 5)

    def test_historical_open_becomes_earliest_if_not_locked(self, db):
        """If a historical period is open (against product rule), it becomes earliest."""
        db.add_all([_period(2024, 1), _period(2026, 5)])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2024, 1)  # Earliest open wins — lock it to fix this

    def test_returns_none_when_no_open_periods(self, db):
        db.add(_period(2026, 5, PeriodStatus.LOCKED))
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result is None

    def test_returns_none_for_tenant_with_no_periods(self, db):
        result = _get_open_period(db, "nonexistent-tenant")
        assert result is None

    def test_ignores_other_tenants(self, db):
        db.add(_period(2026, 5))
        db.add(Period(
            id=str(uuid.uuid4()),
            tenant_id="other-tenant",
            year=2026,
            month=4,
            monthly_fte_cost=99000,
            status=PeriodStatus.OPEN,
        ))
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2026, 5)  # Only own tenant

    def test_single_open_period(self, db):
        db.add(_period(2026, 8))
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2026, 8)

    def test_historical_locked_does_not_affect_result(self, db):
        """Locked historical periods are correctly ignored."""
        db.add_all([
            _period(2024, 1, PeriodStatus.LOCKED),
            _period(2024, 6, PeriodStatus.LOCKED),
            _period(2025, 3, PeriodStatus.LOCKED),
            _period(2026, 5),
        ])
        db.commit()

        result = _get_open_period(db, TENANT)
        assert result == (2026, 5)


# ── _current_open_period (notification_schedules) ─────────────────────────────

class TestCurrentOpenPeriod:
    def test_returns_earliest_open_period(self, db):
        db.add_all([_period(2026, 5), _period(2026, 6)])
        db.commit()

        result = _current_open_period(db, TENANT)
        assert result == (2026, 5)

    def test_may_returned_when_today_is_june(self, db):
        """Same regression guard as scheduler: May must win over June."""
        db.add_all([_period(2026, 5), _period(2026, 6)])
        db.commit()

        result = _current_open_period(db, TENANT)
        assert result == (2026, 5)

    def test_falls_back_to_today_when_no_open_periods(self, db):
        today = date.today()
        db.add(_period(2026, 5, PeriodStatus.LOCKED))
        db.commit()

        result = _current_open_period(db, TENANT)
        assert result == (today.year, today.month)
