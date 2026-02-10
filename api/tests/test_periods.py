"""Tests for period endpoints."""
from datetime import datetime


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
