"""Tests for Manager + PM combined secondary role behavior."""
import pytest
from datetime import datetime

TENANT = "test-tenant-001"

# Manager+PM user
MGR_PM_DB_ID = "mgr-pm-db-001"
MGR_PM_OBJECT_ID = "mgr-pm-001"

# Another manager (no secondary PM)
MGR_ONLY_DB_ID = "mgr-only-db-001"
MGR_ONLY_OBJECT_ID = "mgr-only-001"

# Primary PM user
PM_DB_ID = "pm-db-001"
PM_OBJECT_ID = "pm-pm-001"


# ─── Headers ──────────────────────────────────────────────────────────────────

@pytest.fixture
def mgr_pm_headers():
    """Manager with secondary_role=PM."""
    return {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": TENANT,
        "X-Dev-User-Id": MGR_PM_OBJECT_ID,
        "X-Dev-Email": "mgr.pm@test.com",
        "X-Dev-Name": "Manager PM User",
    }


@pytest.fixture
def mgr_only_headers():
    """Plain Manager with no secondary role."""
    return {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "",  # empty string clears secondary_role
        "X-Dev-Tenant": TENANT,
        "X-Dev-User-Id": MGR_ONLY_OBJECT_ID,
        "X-Dev-Email": "mgr.only@test.com",
        "X-Dev-Name": "Manager Only User",
    }


@pytest.fixture
def primary_pm_headers():
    """Primary PM user."""
    return {
        "X-Dev-Role": "PM",
        "X-Dev-Tenant": TENANT,
        "X-Dev-User-Id": PM_OBJECT_ID,
        "X-Dev-Email": "pm.primary@test.com",
        "X-Dev-Name": "Primary PM User",
    }


# ─── Shared setup fixture ─────────────────────────────────────────────────────

@pytest.fixture
def setup(client, db, admin_headers, finance_headers):
    """Create cost center, two projects (one assigned to mgr_pm, one not), resource, period."""
    from api.app.models.core import User, CostCenter

    # Pre-create Manager+PM user in DB
    mgr_pm_user = User(
        id=MGR_PM_DB_ID,
        tenant_id=TENANT,
        object_id=MGR_PM_OBJECT_ID,
        email="mgr.pm@test.com",
        display_name="Manager PM User",
        role="Manager",
        secondary_role="PM",
    )
    # Pre-create plain Manager user in DB
    mgr_only_user = User(
        id=MGR_ONLY_DB_ID,
        tenant_id=TENANT,
        object_id=MGR_ONLY_OBJECT_ID,
        email="mgr.only@test.com",
        display_name="Manager Only User",
        role="Manager",
    )
    # Pre-create primary PM user in DB
    pm_user = User(
        id=PM_DB_ID,
        tenant_id=TENANT,
        object_id=PM_OBJECT_ID,
        email="pm.primary@test.com",
        display_name="Primary PM User",
        role="PM",
    )
    db.add_all([mgr_pm_user, mgr_only_user, pm_user])
    db.commit()

    # Create cost center and assign mgr_pm user as RO
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-MGRPM", "name": "Mgr PM CC", "ro_user_id": MGR_PM_DB_ID},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]

    # Resource in that cost center
    res_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-MGRPM", "display_name": "CC Resource"},
        headers=admin_headers,
    )
    resource_id = res_resp.json()["id"]

    # Resource in a different cost center (for out-of-scope test)
    cc2_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-OTHER", "name": "Other CC"},
        headers=admin_headers,
    )
    cc2_id = cc2_resp.json()["id"]
    res2_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc2_id, "employee_id": "EMP-OTHER", "display_name": "Other CC Resource"},
        headers=admin_headers,
    )
    resource2_id = res2_resp.json()["id"]

    # PM-assigned project (mgr_pm is PM on this project)
    proj_pm_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-PM-ASSIGNED", "name": "PM Assigned Project", "pm_user_ids": [MGR_PM_DB_ID]},
        headers=admin_headers,
    )
    pm_project_id = proj_pm_resp.json()["id"]

    # Unassigned project
    proj_other_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-UNASSIGNED", "name": "Unassigned Project", "pm_user_ids": [PM_DB_ID]},
        headers=admin_headers,
    )
    other_project_id = proj_other_resp.json()["id"]

    # Open period
    now = datetime.utcnow()
    client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)

    return {
        "cc_id": cc_id,
        "cc2_id": cc2_id,
        "resource_id": resource_id,
        "resource2_id": resource2_id,
        "pm_project_id": pm_project_id,
        "other_project_id": other_project_id,
        "year": now.year,
        "month": now.month,
    }


# ─── A. secondary_role validation via admin API ────────────────────────────────

def test_admin_can_set_secondary_role_pm_on_manager(client, db, admin_headers):
    """Admin can set secondary_role=PM on a Manager user."""
    from api.app.models.core import User
    user = User(
        id="admin-test-user-001",
        tenant_id=TENANT,
        object_id="admin-test-oid-001",
        email="mgr@test.com",
        display_name="Manager",
        role="Manager",
    )
    db.add(user)
    db.commit()
    resp = client.patch(
        f"/admin/users/{user.id}/secondary-role",
        json={"secondary_role": "PM"},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["secondary_role"] == "PM"


def test_admin_can_set_secondary_role_reader_on_manager(client, db, admin_headers):
    """Admin can still set secondary_role=Reader on a Manager user."""
    from api.app.models.core import User
    user = User(
        id="admin-test-user-002",
        tenant_id=TENANT,
        object_id="admin-test-oid-002",
        email="mgr2@test.com",
        display_name="Manager 2",
        role="Manager",
    )
    db.add(user)
    db.commit()
    resp = client.patch(
        f"/admin/users/{user.id}/secondary-role",
        json={"secondary_role": "Reader"},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["secondary_role"] == "Reader"


def test_admin_cannot_set_pm_secondary_role_on_non_manager(client, db, admin_headers):
    """Admin cannot set secondary_role=PM on a non-Manager user."""
    from api.app.models.core import User
    user = User(
        id="admin-test-user-003",
        tenant_id=TENANT,
        object_id="admin-test-oid-003",
        email="emp@test.com",
        display_name="Employee",
        role="Employee",
    )
    db.add(user)
    db.commit()
    resp = client.patch(
        f"/admin/users/{user.id}/secondary-role",
        json={"secondary_role": "PM"},
        headers=admin_headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_SECONDARY_ROLE"


def test_admin_cannot_set_unsupported_secondary_role(client, db, admin_headers):
    """Admin cannot set secondary_role to an unsupported value."""
    from api.app.models.core import User
    user = User(
        id="admin-test-user-004",
        tenant_id=TENANT,
        object_id="admin-test-oid-004",
        email="mgr3@test.com",
        display_name="Manager 3",
        role="Manager",
    )
    db.add(user)
    db.commit()
    resp = client.patch(
        f"/admin/users/{user.id}/secondary-role",
        json={"secondary_role": "Finance"},
        headers=admin_headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_SECONDARY_ROLE"


def test_admin_can_clear_secondary_role(client, db, admin_headers):
    """Admin can clear secondary_role by sending null."""
    from api.app.models.core import User
    user = User(
        id="admin-test-user-005",
        tenant_id=TENANT,
        object_id="admin-test-oid-005",
        email="mgr4@test.com",
        display_name="Manager 4",
        role="Manager",
        secondary_role="PM",
    )
    db.add(user)
    db.commit()
    resp = client.patch(
        f"/admin/users/{user.id}/secondary-role",
        json={"secondary_role": None},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["secondary_role"] is None


# ─── B. /me effective role flags ──────────────────────────────────────────────

def test_me_manager_pm_returns_correct_flags(client, mgr_pm_headers):
    """Manager+PM /me response includes correct flags and merged permissions."""
    resp = client.get("/me", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["role"] == "Manager"
    assert data["secondary_role"] == "PM"
    assert data["is_manager_pm"] is True
    assert data["is_manager_reader"] is False
    assert data["can_pm"] is True
    assert data["can_manage"] is True
    # Must include PM permissions (write:demand) merged in
    assert "write:demand" in data["permissions"]
    # Must include Manager permissions (write:supply)
    assert "write:supply" in data["permissions"]


def test_me_manager_reader_flags_unchanged(client, manager_reader_headers):
    """Manager+Reader /me response still returns correct flags."""
    resp = client.get("/me", headers=manager_reader_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["is_manager_reader"] is True
    assert data["is_manager_pm"] is False
    assert data["can_pm"] is False
    assert data["can_manage"] is True


def test_me_plain_manager_flags(client, mgr_only_headers):
    """Plain Manager /me has no PM flags."""
    resp = client.get("/me", headers=mgr_only_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["is_manager_pm"] is False
    assert data["can_pm"] is False
    assert data["can_manage"] is True


# ─── C. Demand write authorization ────────────────────────────────────────────

def test_manager_pm_can_create_demand_for_assigned_project(client, mgr_pm_headers, setup):
    """Manager+PM can create demand for a project they are assigned to as PM."""
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 200, resp.text


def test_manager_pm_cannot_create_demand_for_unassigned_project(client, mgr_pm_headers, setup):
    """Manager+PM is blocked from creating demand for a project they are not assigned to as PM."""
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["other_project_id"],
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"


def test_manager_without_pm_secondary_cannot_create_demand(client, mgr_only_headers, setup):
    """Plain Manager (no secondary PM) cannot create demand (PM endpoint gate blocks them)."""
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=mgr_only_headers,
    )
    assert resp.status_code == 403


def test_manager_pm_can_update_demand_for_assigned_project(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM can update demand for their assigned project."""
    d = setup
    create_resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]
    resp = client.patch(f"/demand-lines/{demand_id}", json={"fte_percent": 75}, headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text


def test_manager_pm_cannot_update_demand_for_unassigned_project(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM cannot update demand for a project they are not assigned to.

    Uses a resource in the Manager's own CC so the demand line is visible (resource_id in scope),
    then verifies the PM project assignment check fires and returns 403.
    """
    d = setup
    create_resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["other_project_id"],
            "resource_id": d["resource_id"],   # in Manager's CC so get_by_id returns it
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]
    resp = client.patch(f"/demand-lines/{demand_id}", json={"fte_percent": 75}, headers=mgr_pm_headers)
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"


def test_manager_pm_can_delete_demand_for_assigned_project(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM can delete demand for their assigned project."""
    d = setup
    create_resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    demand_id = create_resp.json()["id"]
    resp = client.delete(f"/demand-lines/{demand_id}", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text


# ─── D. Demand GET additive scoping ───────────────────────────────────────────

def test_manager_pm_sees_cc_demand_and_pm_project_demand(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM gets demand from both their CC scope and PM-assigned projects (union)."""
    d = setup

    # Demand in CC-scoped resource + non-PM project (Manager side)
    client.post(
        "/demand-lines",
        json={
            "project_id": d["other_project_id"],
            "resource_id": d["resource_id"],   # resource in managed CC
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 30,
        },
        headers=finance_headers,
    )

    # Demand in PM-assigned project + out-of-scope resource (PM side)
    client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource2_id"],  # resource NOT in managed CC
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 40,
        },
        headers=finance_headers,
    )

    resp = client.get("/demand-lines", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text
    lines = resp.json()
    project_ids = {ln["project_id"] for ln in lines}
    resource_ids = {ln["resource_id"] for ln in lines}

    # Should see CC-scoped demand (resource in their CC)
    assert d["resource_id"] in resource_ids, "Manager+PM must see CC-scoped demand"
    # Should see PM-assigned project demand (even out-of-scope resource)
    assert d["pm_project_id"] in project_ids, "Manager+PM must see PM-assigned project demand"


def test_manager_pm_does_not_see_unrelated_demand(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM does not see demand for projects/resources outside their scope."""
    d = setup

    # Demand in out-of-scope resource + unassigned project
    client.post(
        "/demand-lines",
        json={
            "project_id": d["other_project_id"],
            "resource_id": d["resource2_id"],  # NOT in managed CC
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=finance_headers,
    )

    resp = client.get("/demand-lines", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text
    lines = resp.json()
    # Must not see demand in unrelated (out-of-CC, non-PM-project) resource/project combo
    unrelated = [
        ln for ln in lines
        if ln["resource_id"] == d["resource2_id"] and ln["project_id"] == d["other_project_id"]
    ]
    assert len(unrelated) == 0, "Manager+PM must not see demand outside CC and PM-project scope"


def test_plain_manager_demand_scope_unchanged(client, mgr_only_headers, finance_headers, setup):
    """Plain Manager demand scope is unchanged (CC-scoped only)."""
    d = setup

    # Demand in managed CC resource
    client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource_id"],  # in mgr_pm CC, but mgr_only has own CC
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 25,
        },
        headers=finance_headers,
    )

    resp = client.get("/demand-lines", headers=mgr_only_headers)
    assert resp.status_code == 200, resp.text
    # Plain Manager only sees their own CC scope (mgr_only has no CC assigned in this fixture,
    # so scoped_ids will be empty — they see no demand)
    lines = resp.json()
    # Demand for resource_id (in mgr_pm's CC, not mgr_only's CC) should NOT appear
    assert all(ln["resource_id"] != d["resource_id"] for ln in lines)


# ─── E. Project costs (OoP/Equipment) scoping ────────────────────────────────

def test_manager_pm_can_create_external_line_for_assigned_project(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM can create an external cost line for their assigned PM project."""
    d = setup
    # Create a period via finance for the external line
    period_resp = client.get("/periods", headers=finance_headers)
    period_id = period_resp.json()[0]["id"]

    resp = client.post(
        "/project-costs/externals",
        json={
            "project_id": d["pm_project_id"],
            "period_id": period_id,
            "description": "External consultant",
            "cost": 10000,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 201, resp.text


def test_manager_pm_cannot_create_external_line_for_unassigned_project(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM is blocked from creating external cost lines for unassigned projects."""
    d = setup
    period_resp = client.get("/periods", headers=finance_headers)
    period_id = period_resp.json()[0]["id"]

    resp = client.post(
        "/project-costs/externals",
        json={
            "project_id": d["other_project_id"],
            "period_id": period_id,
            "description": "External consultant",
            "cost": 10000,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"


def test_manager_pm_external_read_scoped_to_pm_projects(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM GET externals returns only their PM-assigned project lines."""
    d = setup
    period_resp = client.get("/periods", headers=finance_headers)
    period_id = period_resp.json()[0]["id"]

    # Finance creates lines for both projects
    client.post(
        "/project-costs/externals",
        json={"project_id": d["pm_project_id"], "period_id": period_id, "description": "A", "cost": 500},
        headers=finance_headers,
    )
    client.post(
        "/project-costs/externals",
        json={"project_id": d["other_project_id"], "period_id": period_id, "description": "B", "cost": 500},
        headers=finance_headers,
    )

    resp = client.get("/project-costs/externals", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text
    lines = resp.json()
    project_ids = {ln["project_id"] for ln in lines}
    assert d["pm_project_id"] in project_ids, "Must see assigned PM project externals"
    assert d["other_project_id"] not in project_ids, "Must not see unassigned project externals"


# ─── F. Manager supply capabilities unchanged ─────────────────────────────────

def test_manager_pm_can_create_supply_for_own_cc(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM retains Manager ability to create supply for their CC resources."""
    d = setup
    resp = client.post(
        "/supply-lines",
        json={
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 100,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 200, resp.text


def test_manager_pm_cannot_create_supply_for_other_cc(client, mgr_pm_headers, finance_headers, setup):
    """Manager+PM cannot create supply for a resource outside their CC scope."""
    d = setup
    resp = client.post(
        "/supply-lines",
        json={
            "resource_id": d["resource2_id"],  # in other CC, not managed
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 100,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"


def test_manager_pm_can_create_supply_for_unassigned_project(client, mgr_pm_headers, setup):
    """Manager+PM can add supply for own CC resource to a project they are NOT assigned as PM.

    Supply is CC/resource-scoped, not PM-project scoped. The Manager decides where team
    capacity goes, regardless of whether they are the PM on that project.
    """
    d = setup
    resp = client.post(
        "/supply-lines",
        json={
            "resource_id": d["resource_id"],  # in Manager's CC
            "project_id": d["other_project_id"],  # NOT a PM-assigned project
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 200, resp.text


def test_manager_pm_can_create_demand_for_resource_in_any_cc(client, mgr_pm_headers, setup):
    """Manager+PM can add demand for a resource in any cost center (not just managed CC).

    Demand is PM-project scoped, not Manager CC-scoped.
    Resource may belong to any CC as long as the project is PM-assigned.
    """
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource2_id"],  # resource in OTHER CC, not Manager's CC
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 30,
        },
        headers=mgr_pm_headers,
    )
    assert resp.status_code == 200, resp.text


# ─── G. Manager+Reader behavior unchanged ─────────────────────────────────────

def test_manager_reader_me_flags_still_correct(client, manager_reader_headers):
    """Manager+Reader /me flags are unchanged after adding PM secondary support."""
    resp = client.get("/me", headers=manager_reader_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["is_manager_reader"] is True
    assert data["is_manager_pm"] is False
    assert data["can_pm"] is False


def test_manager_reader_cannot_create_demand(client, manager_reader_headers, setup):
    """Manager+Reader cannot create demand (no PM secondary role)."""
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=manager_reader_headers,
    )
    assert resp.status_code == 403


# ─── H. Primary PM behavior unchanged ─────────────────────────────────────────

def test_primary_pm_can_create_demand_for_assigned_project(client, primary_pm_headers, setup):
    """Primary PM behavior is unchanged."""
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["other_project_id"],  # assigned to primary PM
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=primary_pm_headers,
    )
    assert resp.status_code == 200, resp.text


def test_primary_pm_cannot_create_demand_for_unassigned_project(client, primary_pm_headers, setup):
    """Primary PM cannot create demand for a project they are not assigned to."""
    d = setup
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": d["pm_project_id"],  # assigned to mgr_pm, not primary PM
            "resource_id": d["resource_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=primary_pm_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "PM_NOT_AUTHORIZED"


# ─── I. list_projects_scoped effective PM scoping ─────────────────────────────

def test_manager_pm_projects_scoped_returns_assigned_only(client, mgr_pm_headers, setup):
    """Manager+PM list_projects_scoped returns only PM-assigned projects."""
    d = setup
    resp = client.get("/lookups/projects/scoped", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text
    ids = [p["id"] for p in resp.json()]
    assert d["pm_project_id"] in ids, "assigned PM project should be returned"


def test_manager_pm_projects_scoped_excludes_unassigned(client, mgr_pm_headers, setup):
    """Manager+PM list_projects_scoped does not return projects they are not PM on."""
    d = setup
    resp = client.get("/lookups/projects/scoped", headers=mgr_pm_headers)
    assert resp.status_code == 200, resp.text
    ids = [p["id"] for p in resp.json()]
    assert d["other_project_id"] not in ids, "unassigned project should not be returned"


def test_primary_pm_projects_scoped_unchanged(client, primary_pm_headers, setup):
    """Primary PM list_projects_scoped still returns only their assigned projects."""
    d = setup
    resp = client.get("/lookups/projects/scoped", headers=primary_pm_headers)
    assert resp.status_code == 200, resp.text
    ids = [p["id"] for p in resp.json()]
    assert d["other_project_id"] in ids, "project assigned to primary PM should be returned"
    assert d["pm_project_id"] not in ids, "project assigned to mgr_pm (not primary PM) should not appear"


def test_manager_only_projects_scoped_is_forbidden(client, mgr_only_headers):
    """Plain Manager (no secondary PM) cannot call list_projects_scoped."""
    resp = client.get("/lookups/projects/scoped", headers=mgr_only_headers)
    assert resp.status_code == 403


# ─── J. PM assignment eligibility & user lookup ───────────────────────────────

def test_pm_user_lookup_includes_manager_pm(client, setup, admin_headers):
    """GET /lookups/users?role=PM includes Manager+PM users alongside primary PMs."""
    resp = client.get("/lookups/users?role=PM", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    user_ids = [u["id"] for u in resp.json()]
    assert MGR_PM_DB_ID in user_ids, "Manager+PM should appear in PM user list"
    assert PM_DB_ID in user_ids, "Primary PM should still appear"


def test_pm_user_lookup_excludes_plain_manager(client, setup, admin_headers):
    """GET /lookups/users?role=PM does not include plain Manager without secondary PM."""
    resp = client.get("/lookups/users?role=PM", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    user_ids = [u["id"] for u in resp.json()]
    assert MGR_ONLY_DB_ID not in user_ids, "Plain Manager should not appear in PM user list"


def test_pm_user_lookup_returns_secondary_role(client, setup, admin_headers):
    """GET /lookups/users?role=PM returns secondary_role field for Manager+PM users."""
    resp = client.get("/lookups/users?role=PM", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    user_map = {u["id"]: u for u in resp.json()}
    mgr_pm_entry = user_map.get(MGR_PM_DB_ID)
    assert mgr_pm_entry is not None
    assert mgr_pm_entry.get("secondary_role") == "PM", "secondary_role should be 'PM'"
    pm_entry = user_map.get(PM_DB_ID)
    assert pm_entry is not None
    # Primary PM has no secondary_role
    assert pm_entry.get("secondary_role") is None


def test_manager_pm_can_be_assigned_as_project_pm(client, setup, admin_headers):
    """Admin can assign a Manager+PM user as project PM."""
    d = setup
    resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-J-VALID", "name": "Valid PM Assign", "pm_user_ids": [MGR_PM_DB_ID]},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert MGR_PM_DB_ID in resp.json()["pm_user_ids"]


def test_primary_pm_can_be_assigned_as_project_pm(client, setup, admin_headers):
    """Primary PM user can still be assigned as project PM."""
    d = setup
    resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-J-PRIM", "name": "Primary PM Assign", "pm_user_ids": [PM_DB_ID]},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert PM_DB_ID in resp.json()["pm_user_ids"]


def test_plain_manager_cannot_be_assigned_as_project_pm(client, setup, admin_headers):
    """Plain Manager (no secondary PM) cannot be assigned as project PM."""
    resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-J-DENY", "name": "Plain Manager PM Deny", "pm_user_ids": [MGR_ONLY_DB_ID]},
        headers=admin_headers,
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "USER_NOT_PM_ELIGIBLE"


def test_update_project_manager_pm_assignment(client, setup, admin_headers):
    """Admin can update a project to assign a Manager+PM user via PATCH."""
    d = setup
    resp = client.patch(
        f"/admin/projects/{d['pm_project_id']}",
        json={"pm_user_ids": [MGR_PM_DB_ID, PM_DB_ID]},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assigned = resp.json()["pm_user_ids"]
    assert MGR_PM_DB_ID in assigned
    assert PM_DB_ID in assigned


def test_update_project_plain_manager_assignment_rejected(client, setup, admin_headers):
    """PATCH project with plain Manager in pm_user_ids is rejected with 422."""
    d = setup
    resp = client.patch(
        f"/admin/projects/{d['pm_project_id']}",
        json={"pm_user_ids": [MGR_ONLY_DB_ID]},
        headers=admin_headers,
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "USER_NOT_PM_ELIGIBLE"
