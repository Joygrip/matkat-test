"""Tests for PM ownership enforcement on demand line operations."""
import pytest
from datetime import datetime


TENANT = "test-tenant-001"

# PM whose DB id matches the X-Dev-User-Id sent in pm_headers
PM_DB_ID = "pm-user-db-001"
PM_OBJECT_ID = "pm-001"  # matches X-Dev-User-Id in conftest pm_headers

# Another PM who is NOT assigned to the test project
OTHER_PM_DB_ID = "pm-user-db-002"
OTHER_PM_OBJECT_ID = "pm-other-001"
OTHER_PM_HEADERS = {
    "X-Dev-Role": "PM",
    "X-Dev-Tenant": TENANT,
    "X-Dev-User-Id": OTHER_PM_OBJECT_ID,
    "X-Dev-Email": "pm-other@test.com",
    "X-Dev-Name": "Other PM",
}


@pytest.fixture
def pm_demand_setup(client, db, admin_headers, finance_headers):
    """
    Creates two Users, a CostCenter, two Projects (one assigned to PM_DB_ID,
    one unassigned), a Resource, and an open Period.
    Returns IDs needed for demand line tests.
    """
    from api.app.models.core import User, CostCenter, Project, Resource, Period

    # Persist the assigned PM user so _check_pm_authorized can resolve object_id → DB id
    pm_user = User(
        id=PM_DB_ID,
        tenant_id=TENANT,
        object_id=PM_OBJECT_ID,
        email="pm@test.com",
        display_name="PM User",
        role="PM",
    )
    other_pm_user = User(
        id=OTHER_PM_DB_ID,
        tenant_id=TENANT,
        object_id=OTHER_PM_OBJECT_ID,
        email="pm-other@test.com",
        display_name="Other PM",
        role="PM",
    )
    db.add_all([pm_user, other_pm_user])
    db.commit()

    # Cost center + resource via API
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-PM", "name": "PM Test CC"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]

    res_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-PM", "display_name": "PM Resource"},
        headers=admin_headers,
    )
    resource_id = res_resp.json()["id"]

    # Project assigned to PM_DB_ID
    proj_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-PM", "name": "PM Project", "pm_user_ids": [PM_DB_ID]},
        headers=admin_headers,
    )
    project_id = proj_resp.json()["id"]

    # Project with no PM assigned
    other_proj_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-OTHER", "name": "Other Project"},
        headers=admin_headers,
    )
    other_project_id = other_proj_resp.json()["id"]

    # Open period for current month
    now = datetime.utcnow()
    client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)

    return {
        "project_id": project_id,
        "other_project_id": other_project_id,
        "resource_id": resource_id,
        "year": now.year,
        "month": now.month,
    }


# ── Create demand ──────────────────────────────────────────────────────────

def test_assigned_pm_can_create_demand(client, pm_headers, pm_demand_setup):
    """Assigned PM can create a demand line for their project."""
    d = pm_demand_setup
    resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=pm_headers,
    )
    assert resp.status_code == 200, resp.text


def test_unassigned_pm_cannot_create_demand(client, pm_demand_setup):
    """A PM not assigned to a project gets 403 when creating demand."""
    d = pm_demand_setup
    resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=OTHER_PM_HEADERS,
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"


def test_any_pm_can_create_demand_for_unassigned_project(client, pm_headers, pm_demand_setup):
    """Any PM may create demand for a project with no assigned PM (no lock yet)."""
    d = pm_demand_setup
    resp = client.post(
        "/demand-lines",
        json={"project_id": d["other_project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=pm_headers,
    )
    assert resp.status_code == 200, resp.text


def test_finance_can_create_demand_for_any_project(client, finance_headers, pm_demand_setup):
    """Finance can create demand on any project regardless of PM assignment."""
    d = pm_demand_setup
    resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 25},
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text


# ── Update demand ──────────────────────────────────────────────────────────

def test_assigned_pm_can_update_demand(client, pm_headers, finance_headers, pm_demand_setup):
    """Assigned PM can update a demand line on their project."""
    d = pm_demand_setup
    # Finance creates the line first
    create_resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]

    resp = client.patch(f"/demand-lines/{demand_id}", json={"fte_percent": 75}, headers=pm_headers)
    assert resp.status_code == 200


def test_unassigned_pm_cannot_update_demand(client, finance_headers, pm_demand_setup):
    """A PM not assigned to the project gets 403 when updating its demand."""
    d = pm_demand_setup
    create_resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]

    resp = client.patch(f"/demand-lines/{demand_id}", json={"fte_percent": 75}, headers=OTHER_PM_HEADERS)
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"


# ── Delete demand ──────────────────────────────────────────────────────────

def test_assigned_pm_can_delete_demand(client, pm_headers, finance_headers, pm_demand_setup):
    """Assigned PM can delete a demand line on their project."""
    d = pm_demand_setup
    create_resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]

    resp = client.delete(f"/demand-lines/{demand_id}", headers=pm_headers)
    assert resp.status_code == 200


def test_unassigned_pm_cannot_delete_demand(client, finance_headers, pm_demand_setup):
    """A PM not assigned to the project gets 403 when deleting its demand."""
    d = pm_demand_setup
    create_resp = client.post(
        "/demand-lines",
        json={"project_id": d["project_id"], "resource_id": d["resource_id"],
              "year": d["year"], "month": d["month"], "fte_percent": 50},
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]

    resp = client.delete(f"/demand-lines/{demand_id}", headers=OTHER_PM_HEADERS)
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"
