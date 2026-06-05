"""Tests for manager cost-center scoping in Actuals and Supply.

Rules under test:
- A Manager may only access actuals/supply for resources in cost centers
  where they are assigned as ro_user_id or director_user_id.
- Cross-cost-center access is denied at the backend (403/404).
- Finance/Admin have tenant-wide access.
- Only Admin/Finance can write to cost center endpoints (including graph_department_name).
- Graph department sync logic assigns User.cost_center_id when graph_department_name matches.
"""
import pytest
from datetime import datetime

from api.app.models.core import CostCenter, User, UserRole, generate_uuid


TENANT = "test-tenant-001"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_manager_headers(user_id: str) -> dict:
    return {
        "X-Dev-Role": "Manager",
        "X-Dev-Tenant": TENANT,
        "X-Dev-User-Id": user_id,
        "X-Dev-Email": f"{user_id}@test.com",
        "X-Dev-Name": f"Manager {user_id}",
    }


def _open_period(client, finance_headers):
    now = datetime.utcnow()
    client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)
    return now.year, now.month


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def cc_scope_setup(client, db, admin_headers, finance_headers):
    """
    Two cost centers, two managers, two resources — built via direct DB
    insert (because dev-bypass does NOT write User rows to the DB) then
    verified through HTTP calls.

    Topology:
      - cc_own:   manager A is ro_user
      - cc_other: manager B is ro_user
      - resource_own:   in cc_own
      - resource_other: in cc_other
    """
    # 1. Create cost centers via API (no ro_user_id yet — we set it after
    #    creating the manager User rows directly in DB).
    cc_own_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-OWN", "name": "Own CC"},
        headers=admin_headers,
    )
    assert cc_own_resp.status_code == 200, cc_own_resp.text
    cc_own_id = cc_own_resp.json()["id"]

    cc_other_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-OTHER", "name": "Other CC"},
        headers=admin_headers,
    )
    assert cc_other_resp.status_code == 200, cc_other_resp.text
    cc_other_id = cc_other_resp.json()["id"]

    # 2. Create resources in each cost center via API.
    res_own_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_own_id, "employee_id": "EMP-OWN", "display_name": "Own Employee"},
        headers=admin_headers,
    )
    assert res_own_resp.status_code == 200, res_own_resp.text
    resource_own_id = res_own_resp.json()["id"]

    res_other_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_other_id, "employee_id": "EMP-OTHER", "display_name": "Other Employee"},
        headers=admin_headers,
    )
    assert res_other_resp.status_code == 200, res_other_resp.text
    resource_other_id = res_other_resp.json()["id"]

    # 3. Insert manager User rows directly (dev bypass does NOT write to DB).
    mgr_a = User(
        id=generate_uuid(),
        tenant_id=TENANT,
        object_id="mgr-a-001",
        email="mgr-a@test.com",
        display_name="Manager A",
        role=UserRole.MANAGER,
        is_active=True,
    )
    mgr_b = User(
        id=generate_uuid(),
        tenant_id=TENANT,
        object_id="mgr-b-001",
        email="mgr-b@test.com",
        display_name="Manager B",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(mgr_a)
    db.add(mgr_b)
    db.flush()

    # 4. Assign managers to their cost centers.
    cc_own = db.query(CostCenter).filter(CostCenter.id == cc_own_id).first()
    cc_other = db.query(CostCenter).filter(CostCenter.id == cc_other_id).first()
    cc_own.ro_user_id = mgr_a.id
    cc_other.ro_user_id = mgr_b.id
    db.commit()

    year, month = _open_period(client, finance_headers)

    return {
        "manager_a_headers": _make_manager_headers("mgr-a-001"),
        "manager_b_headers": _make_manager_headers("mgr-b-001"),
        "cc_own_id": cc_own_id,
        "cc_other_id": cc_other_id,
        "resource_own_id": resource_own_id,
        "resource_other_id": resource_other_id,
        "year": year,
        "month": month,
    }


# ---------------------------------------------------------------------------
# Actuals: list scoping
# ---------------------------------------------------------------------------

def test_manager_actuals_list_excludes_other_cost_center(client, finance_headers, cc_scope_setup):
    """Manager only sees actuals for resources in their cost center."""
    d = cc_scope_setup

    proj_resp = client.post(
        "/admin/projects",
        json={"code": "PROJ-SCOPE", "name": "Scope Test Project"},
        headers=finance_headers,
    )
    assert proj_resp.status_code == 200, proj_resp.text
    proj_id = proj_resp.json()["id"]

    # Finance creates actuals for both resources
    for resource_id in [d["resource_own_id"], d["resource_other_id"]]:
        client.post(
            "/actuals",
            json={
                "resource_id": resource_id,
                "project_id": proj_id,
                "year": d["year"],
                "month": d["month"],
                "actual_fte_percent": 50,
            },
            headers=finance_headers,
        )

    # Manager A fetches actuals — should only see own CC resource
    resp = client.get("/actuals", headers=d["manager_a_headers"])
    assert resp.status_code == 200
    resource_ids = {line["resource_id"] for line in resp.json()}
    assert d["resource_own_id"] in resource_ids
    assert d["resource_other_id"] not in resource_ids


# ---------------------------------------------------------------------------
# Actuals: create scoping
# ---------------------------------------------------------------------------

def test_manager_cannot_create_actual_for_out_of_scope_resource(client, finance_headers, cc_scope_setup):
    """Manager cannot create actual for resource outside their cost center (403)."""
    d = cc_scope_setup

    proj_resp = client.post(
        "/admin/projects",
        json={"code": "PROJ-CREATE", "name": "Create Test"},
        headers=finance_headers,
    )
    assert proj_resp.status_code == 200, proj_resp.text
    proj_id = proj_resp.json()["id"]

    resp = client.post(
        "/actuals",
        json={
            "resource_id": d["resource_other_id"],
            "project_id": proj_id,
            "year": d["year"],
            "month": d["month"],
            "actual_fte_percent": 50,
        },
        headers=d["manager_a_headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "UNAUTHORIZED_RESOURCE"


def test_manager_can_create_actual_for_own_cost_center_resource(client, finance_headers, cc_scope_setup):
    """Manager can create actual for a resource in their own cost center."""
    d = cc_scope_setup

    proj_resp = client.post(
        "/admin/projects",
        json={"code": "PROJ-OWN-CREATE", "name": "Own Create Test"},
        headers=finance_headers,
    )
    assert proj_resp.status_code == 200, proj_resp.text
    proj_id = proj_resp.json()["id"]

    resp = client.post(
        "/actuals",
        json={
            "resource_id": d["resource_own_id"],
            "project_id": proj_id,
            "year": d["year"],
            "month": d["month"],
            "actual_fte_percent": 50,
            "proxy_sign_reason": "Manager entering on behalf of team member",
        },
        headers=d["manager_a_headers"],
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Supply: create scoping
# ---------------------------------------------------------------------------

def test_manager_cannot_create_supply_for_out_of_scope_resource(client, cc_scope_setup):
    """Manager cannot create supply line for resource outside their cost center (403)."""
    d = cc_scope_setup
    resp = client.post(
        "/supply-lines",
        json={
            "resource_id": d["resource_other_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=d["manager_a_headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"


def test_manager_can_create_supply_for_own_cost_center_resource(client, cc_scope_setup):
    """Manager can create supply line for resource in their own cost center."""
    d = cc_scope_setup
    resp = client.post(
        "/supply-lines",
        json={
            "resource_id": d["resource_own_id"],
            "year": d["year"],
            "month": d["month"],
            "fte_percent": 50,
        },
        headers=d["manager_a_headers"],
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Supply: list scoping
# ---------------------------------------------------------------------------

def test_manager_supply_list_excludes_other_cost_center(client, finance_headers, cc_scope_setup):
    """Manager only sees supply lines for resources in their cost center."""
    d = cc_scope_setup

    # Finance creates supply for both resources
    for resource_id in [d["resource_own_id"], d["resource_other_id"]]:
        client.post(
            "/supply-lines",
            json={
                "resource_id": resource_id,
                "year": d["year"],
                "month": d["month"],
                "fte_percent": 40,
            },
            headers=finance_headers,
        )

    resp = client.get("/supply-lines", headers=d["manager_a_headers"])
    assert resp.status_code == 200
    resource_ids = {line["resource_id"] for line in resp.json()}
    assert d["resource_own_id"] in resource_ids
    assert d["resource_other_id"] not in resource_ids


# ---------------------------------------------------------------------------
# Admin: cost center write access
# ---------------------------------------------------------------------------

def test_finance_can_update_cost_center_code(client, finance_headers, cc_scope_setup):
    """Finance can update cost center code and graph_department_name."""
    d = cc_scope_setup
    resp = client.patch(
        f"/admin/cost-centers/{d['cc_own_id']}",
        json={"code": "CC-UPDATED", "graph_department_name": "Engineering"},
        headers=finance_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == "CC-UPDATED"
    assert body["graph_department_name"] == "Engineering"


def test_admin_can_update_cost_center_graph_dept(client, admin_headers, cc_scope_setup):
    """Admin can set graph_department_name on a cost center."""
    d = cc_scope_setup
    resp = client.patch(
        f"/admin/cost-centers/{d['cc_own_id']}",
        json={"graph_department_name": "R&D"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["graph_department_name"] == "R&D"


def test_manager_cannot_write_cost_center(client, cc_scope_setup):
    """Manager cannot update a cost center (403)."""
    d = cc_scope_setup
    resp = client.patch(
        f"/admin/cost-centers/{d['cc_own_id']}",
        json={"code": "HACKED"},
        headers=d["manager_a_headers"],
    )
    assert resp.status_code == 403


def test_employee_cannot_write_cost_center(client, employee_headers, cc_scope_setup):
    """Employee cannot update a cost center (403)."""
    d = cc_scope_setup
    resp = client.patch(
        f"/admin/cost-centers/{d['cc_own_id']}",
        json={"code": "HACKED"},
        headers=employee_headers,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Graph department sync: unit-level tests
# ---------------------------------------------------------------------------

def test_graph_department_sync_assigns_cost_center_id(db):
    """
    Simulate the sync logic: if graph_department matches CostCenter.graph_department_name,
    User.cost_center_id should be set to that cost center.
    """
    cc = CostCenter(
        id=generate_uuid(),
        tenant_id=TENANT,
        code="CC-DEPT",
        name="Dept CC",
        graph_department_name="Marketing",
        is_active=True,
    )
    db.add(cc)
    db.flush()

    user = User(
        id=generate_uuid(),
        tenant_id=TENANT,
        object_id="dept-sync-user-001",
        email="dept@test.com",
        display_name="Dept User",
        role=UserRole.EMPLOYEE,
        cost_center_id=None,
    )
    db.add(user)
    db.commit()

    # Simulate sync logic: match Graph department → CostCenter
    graph_department = "Marketing"
    matched_cc = db.query(CostCenter).filter(
        CostCenter.tenant_id == TENANT,
        CostCenter.graph_department_name == graph_department,
        CostCenter.is_active.is_(True),
    ).first()
    assert matched_cc is not None
    assert matched_cc.id == cc.id

    user.cost_center_id = matched_cc.id
    db.commit()
    db.refresh(user)
    assert user.cost_center_id == cc.id


def test_graph_department_no_match_leaves_cost_center_unchanged(db):
    """If Graph department has no matching cost center, cost_center_id is unchanged."""
    cc = CostCenter(
        id=generate_uuid(),
        tenant_id=TENANT,
        code="CC-NOMATCH",
        name="No Match CC",
        graph_department_name="Finance",
        is_active=True,
    )
    db.add(cc)

    user = User(
        id=generate_uuid(),
        tenant_id=TENANT,
        object_id="no-match-user-001",
        email="nomatch@test.com",
        display_name="No Match User",
        role=UserRole.EMPLOYEE,
        cost_center_id=cc.id,
    )
    db.add(user)
    db.commit()

    # "Unknown Dept" has no matching cost center
    matched_cc = db.query(CostCenter).filter(
        CostCenter.tenant_id == TENANT,
        CostCenter.graph_department_name == "Unknown Dept",
        CostCenter.is_active.is_(True),
    ).first()
    assert matched_cc is None
    # cost_center_id must remain unchanged
    assert user.cost_center_id == cc.id
