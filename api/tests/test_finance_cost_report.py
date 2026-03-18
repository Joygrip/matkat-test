"""Tests for Finance Cost Report: settings endpoints, formula, and access control."""
import pytest
from fastapi.testclient import TestClient


# ─── Pure formula test (no HTTP) ────────────────────────────────────────────

def test_formula_math():
    """50% FTE of 99,000 DKK/month = 49,500 DKK."""
    fte_percent = 50
    monthly_fte_cost = 99000
    result = round((fte_percent / 100) * monthly_fte_cost)
    assert result == 49500


def test_formula_math_full_fte():
    """100% FTE = full monthly cost."""
    assert round((100 / 100) * 99000) == 99000


def test_formula_math_zero_fte():
    """0% FTE = 0 cost."""
    assert round((0 / 100) * 99000) == 0


# ─── GET /finance/settings/{key} ────────────────────────────────────────────

def test_get_setting_default_for_finance(client, finance_headers):
    """Finance user gets default 99000 when no setting has been saved."""
    res = client.get("/finance/settings/monthly_fte_cost", headers=finance_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["setting_key"] == "monthly_fte_cost"
    assert data["setting_value"] == "99000"


def test_get_setting_default_for_admin(client, admin_headers):
    """Admin user also gets default 99000."""
    res = client.get("/finance/settings/monthly_fte_cost", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["setting_value"] == "99000"


def test_get_setting_forbidden_for_ro(client, ro_headers):
    """RO role cannot access finance settings."""
    res = client.get("/finance/settings/monthly_fte_cost", headers=ro_headers)
    assert res.status_code == 403


def test_get_setting_forbidden_for_director(client, director_headers):
    """Director role cannot access finance settings."""
    res = client.get("/finance/settings/monthly_fte_cost", headers=director_headers)
    assert res.status_code == 403


def test_get_setting_forbidden_for_employee(client, employee_headers):
    """Employee role cannot access finance settings."""
    res = client.get("/finance/settings/monthly_fte_cost", headers=employee_headers)
    assert res.status_code == 403


# ─── PUT /finance/settings/{key} ────────────────────────────────────────────

def test_put_setting_finance_allowed(client, finance_headers):
    """Finance user can update the monthly FTE cost."""
    res = client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "80000"},
        headers=finance_headers,
    )
    assert res.status_code == 200
    assert res.json()["setting_value"] == "80000"


def test_put_setting_admin_allowed(client, admin_headers):
    """Admin user can also update the monthly FTE cost."""
    res = client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "88000"},
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.json()["setting_value"] == "88000"


def test_put_setting_ro_forbidden(client, ro_headers):
    """RO role cannot update finance settings."""
    res = client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "80000"},
        headers=ro_headers,
    )
    assert res.status_code == 403


def test_put_setting_director_forbidden(client, director_headers):
    """Director role cannot update finance settings."""
    res = client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "80000"},
        headers=director_headers,
    )
    assert res.status_code == 403


# ─── Cost override persistence (recalculation round-trip) ───────────────────

def test_cost_override_persists(client, finance_headers):
    """After updating the setting, GET returns the new value."""
    client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "75000"},
        headers=finance_headers,
    )
    res = client.get("/finance/settings/monthly_fte_cost", headers=finance_headers)
    assert res.status_code == 200
    assert res.json()["setting_value"] == "75000"


def test_cost_override_recalculation(client, finance_headers):
    """Override to 80000; frontend formula: 50% of 80000 = 40000."""
    client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "80000"},
        headers=finance_headers,
    )
    res = client.get("/finance/settings/monthly_fte_cost", headers=finance_headers)
    overridden_cost = int(res.json()["setting_value"])
    calculated = round((50 / 100) * overridden_cost)
    assert calculated == 40000


def test_upsert_replaces_existing(client, finance_headers):
    """Calling PUT twice updates the value rather than creating a duplicate."""
    client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "75000"},
        headers=finance_headers,
    )
    client.put(
        "/finance/settings/monthly_fte_cost",
        json={"setting_value": "95000"},
        headers=finance_headers,
    )
    res = client.get("/finance/settings/monthly_fte_cost", headers=finance_headers)
    assert res.json()["setting_value"] == "95000"
