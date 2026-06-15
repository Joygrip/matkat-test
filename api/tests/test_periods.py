"""Tests for period endpoints and service behavior.

Note: the auto/open/locked status rule is exercised end-to-end against the real
PeriodService via the POST /periods/years tests (TestCreateYear) below.
"""
from datetime import datetime, timezone

from api.app.models.finance import FinanceSetting


def test_create_period_as_finance(client, finance_headers, db):
    """Finance can create a period."""
    response = client.post(
        "/periods",
        json={"year": 2026, "month": 3},
        headers=finance_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["year"] == 2026
    assert data["month"] == 3
    assert data["status"] == "open"


def test_create_period_as_employee_forbidden(client, employee_headers, db):
    """Employee cannot create a period."""
    response = client.post(
        "/periods",
        json={"year": 2026, "month": 3},
        headers=employee_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "UNAUTHORIZED_ROLE"


def test_lock_period(client, finance_headers, db):
    """Finance can lock a period."""
    # Create period
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 4},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    
    # Lock it
    lock_resp = client.post(
        f"/periods/{period_id}/lock",
        headers=finance_headers,
    )
    assert lock_resp.status_code == 200
    data = lock_resp.json()
    assert data["status"] == "locked"
    assert data["locked_at"] is not None


def test_unlock_requires_reason(client, finance_headers, db):
    """Unlock must have a reason."""
    # Create and lock period
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 5},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    client.post(f"/periods/{period_id}/lock", headers=finance_headers)
    
    # Try to unlock without reason
    unlock_resp = client.post(
        f"/periods/{period_id}/unlock",
        json={"reason": ""},
        headers=finance_headers,
    )
    assert unlock_resp.status_code == 400
    assert "required" in unlock_resp.json()["detail"].lower()


def test_unlock_with_reason(client, finance_headers, db):
    """Finance can unlock with a reason."""
    # Create and lock period
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 6},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    client.post(f"/periods/{period_id}/lock", headers=finance_headers)
    
    # Unlock with reason
    unlock_resp = client.post(
        f"/periods/{period_id}/unlock",
        json={"reason": "Need to correct actuals for Project X"},
        headers=finance_headers,
    )
    assert unlock_resp.status_code == 200
    data = unlock_resp.json()
    assert data["status"] == "open"


def test_pm_cannot_lock(client, finance_headers, pm_headers, db):
    """PM cannot lock periods."""
    # Create period as finance
    create_resp = client.post(
        "/periods",
        json={"year": 2026, "month": 7},
        headers=finance_headers,
    )
    period_id = create_resp.json()["id"]
    
    # Try to lock as PM
    lock_resp = client.post(
        f"/periods/{period_id}/lock",
        headers=pm_headers,
    )
    assert lock_resp.status_code == 403


def test_list_periods(client, finance_headers, db):
    """List all periods."""
    # Create some periods
    client.post("/periods", json={"year": 2026, "month": 1}, headers=finance_headers)
    client.post("/periods", json={"year": 2026, "month": 2}, headers=finance_headers)
    
    # List
    response = client.get("/periods", headers=finance_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 2


def test_tenant_isolation(client, finance_headers, db):
    """Periods are tenant-isolated."""
    # Create period in tenant 1
    client.post("/periods", json={"year": 2026, "month": 8}, headers=finance_headers)
    
    # Try to list with different tenant
    other_tenant_headers = {
        "X-Dev-Role": "Finance",
        "X-Dev-Tenant": "other-tenant-999",
        "X-Dev-User-Id": "finance-other",
        "X-Dev-Email": "finance@other.com",
        "X-Dev-Name": "Other Finance",
    }
    response = client.get("/periods", headers=other_tenant_headers)
    assert response.status_code == 200
    # Should not see the period from different tenant
    periods = response.json()
    tenant_ids = [p["tenant_id"] for p in periods]
    assert "test-tenant-001" not in tenant_ids


def test_create_period_uses_global_monthly_fte_cost_when_no_prior_period(client, finance_headers, db):
    """When no prior period exists, creation falls back to tenant global monthly_fte_cost."""
    db.add(
        FinanceSetting(
            tenant_id="test-tenant-001",
            setting_key="monthly_fte_cost",
            setting_value="123456",
            updated_by="finance-001",
        )
    )
    db.commit()

    response = client.post(
        "/periods",
        json={"year": 2027, "month": 1},
        headers=finance_headers,
    )
    assert response.status_code == 200
    assert response.json()["monthly_fte_cost"] == 123456


def test_create_period_copies_latest_prior_period_monthly_fte_cost(client, finance_headers, db):
    """New period should inherit monthly_fte_cost from latest prior period."""
    jan = client.post(
        "/periods",
        json={"year": 2027, "month": 1},
        headers=finance_headers,
    )
    assert jan.status_code == 200
    jan_id = jan.json()["id"]

    upd = client.put(
        "/finance/settings/monthly_fte_cost?period_id=" + jan_id,
        json={"setting_value": "111111"},
        headers=finance_headers,
    )
    assert upd.status_code == 200

    feb = client.post(
        "/periods",
        json={"year": 2027, "month": 2},
        headers=finance_headers,
    )
    assert feb.status_code == 200
    assert feb.json()["monthly_fte_cost"] == 111111


# ── POST /periods/years ────────────────────────────────────────────────────────

class TestCreateYear:
    def test_auto_past_year_creates_locked(self, client, finance_headers, db):
        """status=auto + past year → all 12 created as locked."""
        resp = client.post("/periods/years", json={"year": 2020, "status": "auto"}, headers=finance_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["year"] == 2020
        assert data["status_used"] == "locked"
        assert data["created"] == 12
        assert data["skipped_existing"] == 0

        # Verify status in DB via list endpoint
        list_resp = client.get("/periods", headers=finance_headers)
        created = [p for p in list_resp.json() if p["year"] == 2020]
        assert len(created) == 12
        assert all(p["status"] == "locked" for p in created)

    def test_auto_current_year_creates_open(self, client, finance_headers, db):
        """status=auto + current year → created as open."""
        current_year = datetime.now(tz=timezone.utc).year
        resp = client.post("/periods/years", json={"year": current_year, "status": "auto"}, headers=finance_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status_used"] == "open"
        assert data["created"] == 12

        list_resp = client.get("/periods", headers=finance_headers)
        created = [p for p in list_resp.json() if p["year"] == current_year]
        assert all(p["status"] == "open" for p in created)

    def test_explicit_open_creates_open_for_past_year(self, client, finance_headers, db):
        """status=open forces open even for past year."""
        resp = client.post("/periods/years", json={"year": 2019, "status": "open"}, headers=finance_headers)
        assert resp.status_code == 200
        assert resp.json()["status_used"] == "open"
        assert resp.json()["created"] == 12

        list_resp = client.get("/periods", headers=finance_headers)
        created = [p for p in list_resp.json() if p["year"] == 2019]
        assert all(p["status"] == "open" for p in created)

    def test_explicit_locked_creates_locked_for_future_year(self, client, finance_headers, db):
        """status=locked forces locked even for future year."""
        current_year = datetime.now(tz=timezone.utc).year
        resp = client.post("/periods/years", json={"year": current_year + 1, "status": "locked"}, headers=finance_headers)
        assert resp.status_code == 200
        assert resp.json()["status_used"] == "locked"
        assert resp.json()["created"] == 12

    def test_skips_existing_months(self, client, finance_headers, db):
        """Months that already exist are skipped, not updated."""
        # Pre-create Jan–Mar 2030 as open
        for month in range(1, 4):
            client.post("/periods", json={"year": 2030, "month": month}, headers=finance_headers)

        resp = client.post("/periods/years", json={"year": 2030, "status": "locked"}, headers=finance_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 9       # Apr–Dec
        assert data["skipped_existing"] == 3  # Jan–Mar

        # Pre-existing months keep their original open status (not overwritten to locked)
        list_resp = client.get("/periods", headers=finance_headers)
        existing = [p for p in list_resp.json() if p["year"] == 2030 and p["month"] in (1, 2, 3)]
        assert all(p["status"] == "open" for p in existing)

    def test_all_months_exist_returns_zero_created(self, client, finance_headers, db):
        """If all 12 months already exist, created=0."""
        current_year = datetime.now(tz=timezone.utc).year
        # Create all 12 first
        client.post("/periods/years", json={"year": current_year, "status": "open"}, headers=finance_headers)
        # Call again
        resp = client.post("/periods/years", json={"year": current_year, "status": "open"}, headers=finance_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"] == 0
        assert data["skipped_existing"] == 12

    def test_monthly_fte_cost_populated(self, client, finance_headers, db):
        """Created periods have a non-zero monthly_fte_cost."""
        resp = client.post("/periods/years", json={"year": 2021, "status": "locked"}, headers=finance_headers)
        assert resp.status_code == 200

        list_resp = client.get("/periods", headers=finance_headers)
        created = [p for p in list_resp.json() if p["year"] == 2021]
        assert all(p["monthly_fte_cost"] > 0 for p in created)

    def test_unauthorized_role_rejected(self, client, pm_headers, db):
        """Non-Finance/Admin roles cannot call POST /periods/years."""
        resp = client.post("/periods/years", json={"year": 2025, "status": "auto"}, headers=pm_headers)
        assert resp.status_code == 403

    def test_year_out_of_range_rejected(self, client, finance_headers, db):
        """Years outside the valid range are rejected."""
        resp = client.post("/periods/years", json={"year": 1999, "status": "auto"}, headers=finance_headers)
        assert resp.status_code == 422
