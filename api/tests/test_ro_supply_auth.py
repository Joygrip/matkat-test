"""Tests for RO resource scope enforcement on supply line create."""
import pytest
from datetime import datetime


TENANT = "test-tenant-001"


@pytest.fixture
def ro_supply_setup(client, admin_headers, finance_headers):
    """Create cost center, resource, and open period for RO scope tests."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-RO-AUTH", "name": "RO Auth Test CC"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]

    resource_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-RO-AUTH",
            "display_name": "RO Auth Employee",
        },
        headers=admin_headers,
    )
    resource_id = resource_resp.json()["id"]

    now = datetime.utcnow()
    client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )

    return {
        "resource_id": resource_id,
        "year": now.year,
        "month": now.month,
    }


def test_ro_cannot_create_supply_for_out_of_scope_resource(client, ro_headers, ro_supply_setup):
    """Manager without reporting chain cannot create supply for a resource outside their scope."""
    data = ro_supply_setup
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["year"],
            "month": data["month"],
            "fte_percent": 50,
        },
        headers=ro_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "MANAGER_NOT_AUTHORIZED"


def test_finance_can_create_supply_for_any_resource(client, finance_headers, ro_supply_setup):
    """Finance can create supply for any resource (no scope restriction)."""
    data = ro_supply_setup
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["year"],
            "month": data["month"],
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    assert response.status_code == 200
