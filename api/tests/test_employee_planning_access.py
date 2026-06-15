"""Access-control tests for Employee role against Resource Planning endpoints.

Employees must NOT be able to read the broad planning matrix feeds
(/demand-lines/all, /supply-lines/all) and must only ever see their own
resource's lines through the filtered /demand-lines and /supply-lines
endpoints — regardless of any resource_id they supply. They must never be
able to create/update/delete planning lines.
"""
import pytest
from datetime import datetime


TENANT = "test-tenant-001"
EMPLOYEE_OBJECT_ID = "employee-001"  # matches employee_headers in conftest


@pytest.fixture
def planning_setup(client, db, admin_headers, finance_headers, employee_headers):
    """Create a project, two resources (one linked to the Employee, one not),
    an open period, and a demand + supply line for each resource.

    Returns the IDs needed by the tests.
    """
    from api.app.models.core import User, Resource

    # Provision the Employee user via an authenticated request (dev bypass upserts it).
    client.get("/demand-lines", headers=employee_headers)
    emp_user = db.query(User).filter(
        User.tenant_id == TENANT,
        User.object_id == EMPLOYEE_OBJECT_ID,
    ).first()
    assert emp_user is not None

    # Cost center
    cc_id = client.post(
        "/admin/cost-centers",
        json={"code": "CC-EMP", "name": "Employee Test CC"},
        headers=admin_headers,
    ).json()["id"]

    # Two resources
    own_resource_id = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-OWN", "display_name": "Own Resource"},
        headers=admin_headers,
    ).json()["id"]
    other_resource_id = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-OTHER", "display_name": "Other Resource"},
        headers=admin_headers,
    ).json()["id"]

    # Link the "own" resource to the Employee's user account.
    db.query(Resource).filter(Resource.id == own_resource_id).update({"user_id": emp_user.id})
    db.commit()

    # Project
    project_id = client.post(
        "/admin/projects",
        json={"code": "PRJ-EMP", "name": "Employee Project"},
        headers=admin_headers,
    ).json()["id"]

    # Open period
    now = datetime.utcnow()
    client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)

    # A demand + supply line for each resource (created by Finance).
    for rid in (own_resource_id, other_resource_id):
        assert client.post(
            "/demand-lines",
            json={"project_id": project_id, "resource_id": rid,
                  "year": now.year, "month": now.month, "fte_percent": 50},
            headers=finance_headers,
        ).status_code == 200
        assert client.post(
            "/supply-lines",
            json={"resource_id": rid, "project_id": project_id,
                  "year": now.year, "month": now.month, "fte_percent": 50},
            headers=finance_headers,
        ).status_code == 200

    return {
        "project_id": project_id,
        "own_resource_id": own_resource_id,
        "other_resource_id": other_resource_id,
        "year": now.year,
        "month": now.month,
    }


# ── Broad matrix feeds are blocked for Employee ──────────────────────────────

def test_employee_cannot_read_all_demand_lines(client, employee_headers, planning_setup):
    resp = client.get("/demand-lines/all", headers=employee_headers)
    assert resp.status_code == 403


def test_employee_cannot_read_all_supply_lines(client, employee_headers, planning_setup):
    resp = client.get("/supply-lines/all", headers=employee_headers)
    assert resp.status_code == 403


# ── Filtered reads are hard-scoped to the Employee's own resource ────────────

def test_employee_demand_lines_scoped_to_own_resource(client, employee_headers, planning_setup):
    """Even with no filter, Employee only sees their own resource's demand line."""
    resp = client.get("/demand-lines", headers=employee_headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert {r["resource_id"] for r in rows} == {planning_setup["own_resource_id"]}


def test_employee_cannot_enumerate_others_demand(client, employee_headers, planning_setup):
    """Supplying another resource_id must not leak that resource's lines."""
    resp = client.get(
        f"/demand-lines?resource_id={planning_setup['other_resource_id']}",
        headers=employee_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


def test_employee_supply_lines_scoped_to_own_resource(client, employee_headers, planning_setup):
    resp = client.get("/supply-lines", headers=employee_headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert {r["resource_id"] for r in rows} == {planning_setup["own_resource_id"]}


def test_employee_cannot_enumerate_others_supply(client, employee_headers, planning_setup):
    resp = client.get(
        f"/supply-lines?resource_id={planning_setup['other_resource_id']}",
        headers=employee_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ── Writes are blocked for Employee ──────────────────────────────────────────

def test_employee_cannot_create_demand(client, employee_headers, planning_setup):
    d = planning_setup
    resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["own_resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 25},
        headers=employee_headers,
    )
    assert resp.status_code == 403


def test_employee_cannot_create_supply(client, employee_headers, planning_setup):
    d = planning_setup
    resp = client.post(
        "/supply-lines",
        json={"resource_id": d["own_resource_id"], "project_id": d["project_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 25},
        headers=employee_headers,
    )
    assert resp.status_code == 403


# ── Privileged roles retain broad access (regression guard) ──────────────────

@pytest.mark.parametrize("headers_fixture", ["admin_headers", "finance_headers", "pm_headers", "ro_headers"])
def test_privileged_roles_can_read_all_demand(client, planning_setup, request, headers_fixture):
    headers = request.getfixturevalue(headers_fixture)
    resp = client.get("/demand-lines/all", headers=headers)
    assert resp.status_code == 200


@pytest.mark.parametrize("headers_fixture", ["admin_headers", "finance_headers", "pm_headers", "ro_headers"])
def test_privileged_roles_can_read_all_supply(client, planning_setup, request, headers_fixture):
    headers = request.getfixturevalue(headers_fixture)
    resp = client.get("/supply-lines/all", headers=headers)
    assert resp.status_code == 200
