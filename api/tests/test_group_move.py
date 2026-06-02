"""Tests for supply-lines/group/move and demand-lines/group/move endpoints."""
import pytest
from datetime import datetime
from dateutil.relativedelta import relativedelta

from api.app.models.core import CostCenter, User, UserRole


TENANT = "test-tenant-001"


# ============== FIXTURES ==============

@pytest.fixture
def move_setup(client, admin_headers, finance_headers, db):
    """Create two projects, two resources in the same cost center, and open periods."""
    # Create Manager DB row so supply scope checks pass
    ro_user = User(
        tenant_id=TENANT,
        object_id="ro-001",
        email="ro@test.com",
        display_name="Manager User",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(ro_user)
    db.commit()
    db.refresh(ro_user)

    # Cost center owned by the manager
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-MOVE", "name": "Move Test CC"},
        headers=admin_headers,
    )
    assert cc_resp.status_code in (200, 201), cc_resp.text
    cc_id = cc_resp.json()["id"]

    # Assign manager as ro_user_id so _check_ro_resource_authorized passes
    cc = db.query(CostCenter).filter(CostCenter.id == cc_id).first()
    cc.ro_user_id = ro_user.id
    db.commit()

    # Two projects
    proj_a_resp = client.post(
        "/admin/projects",
        json={"code": "MOVE-A", "name": "Move Project A"},
        headers=admin_headers,
    )
    assert proj_a_resp.status_code in (200, 201), proj_a_resp.text
    project_a_id = proj_a_resp.json()["id"]

    proj_b_resp = client.post(
        "/admin/projects",
        json={"code": "MOVE-B", "name": "Move Project B"},
        headers=admin_headers,
    )
    assert proj_b_resp.status_code in (200, 201), proj_b_resp.text
    project_b_id = proj_b_resp.json()["id"]

    # Two resources in the same cost center
    res_1_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-MV1", "display_name": "Move Employee 1"},
        headers=admin_headers,
    )
    assert res_1_resp.status_code in (200, 201), res_1_resp.text
    resource_1_id = res_1_resp.json()["id"]

    res_2_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-MV2", "display_name": "Move Employee 2"},
        headers=admin_headers,
    )
    assert res_2_resp.status_code in (200, 201), res_2_resp.text
    resource_2_id = res_2_resp.json()["id"]

    # Placeholder for demand tests
    placeholders = client.get("/admin/placeholders", headers=admin_headers).json()
    placeholder_id = next(p["id"] for p in placeholders if p["cost_center_id"] == cc_id)

    # Open periods: current month and next month
    now = datetime.utcnow()
    nxt = now + relativedelta(months=1)
    client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)
    client.post("/periods", json={"year": nxt.year, "month": nxt.month}, headers=finance_headers)

    # Fetch period IDs
    periods_resp = client.get("/periods", headers=finance_headers)
    all_periods = periods_resp.json()
    period_now = next(p for p in all_periods if p["year"] == now.year and p["month"] == now.month)
    period_nxt = next(p for p in all_periods if p["year"] == nxt.year and p["month"] == nxt.month)

    return {
        "project_a_id": project_a_id,
        "project_b_id": project_b_id,
        "resource_1_id": resource_1_id,
        "resource_2_id": resource_2_id,
        "placeholder_id": placeholder_id,
        "period_now_id": period_now["id"],
        "period_nxt_id": period_nxt["id"],
        "now_year": now.year,
        "now_month": now.month,
        "nxt_year": nxt.year,
        "nxt_month": nxt.month,
    }


def _make_supply(client, headers, resource_id, project_id, year, month, fte=50):
    """Helper: create a supply line; assert 200."""
    resp = client.post(
        "/supply-lines",
        json={"resource_id": resource_id, "project_id": project_id,
              "year": year, "month": month, "fte_percent": fte},
        headers=headers,
    )
    assert resp.status_code == 200, f"Supply create failed: {resp.text}"
    return resp.json()


def _move_supply(client, headers, from_res, to_res, proj, to_proj, period_ids):
    """Helper: call supply group/move."""
    return client.post(
        "/supply-lines/group/move",
        json={"from_resource_id": from_res, "to_resource_id": to_res,
              "project_id": proj, "to_project_id": to_proj,
              "period_ids": period_ids},
        headers=headers,
    )


# ============== SUPPLY MOVE TESTS ==============

def test_supply_move_different_resource_same_project(client, finance_headers, move_setup):
    """Move supply from resource 1 to resource 2, same project — succeeds."""
    d = move_setup
    _make_supply(client, finance_headers, d["resource_1_id"], d["project_a_id"],
                 d["now_year"], d["now_month"])

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_a_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_supply_move_same_resource_different_project(client, finance_headers, move_setup):
    """Move supply to same resource but different project — succeeds."""
    d = move_setup
    _make_supply(client, finance_headers, d["resource_1_id"], d["project_a_id"],
                 d["now_year"], d["now_month"])

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_1_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_supply_move_different_resource_different_project(client, finance_headers, move_setup):
    """Move supply to different resource AND different project — succeeds."""
    d = move_setup
    _make_supply(client, finance_headers, d["resource_1_id"], d["project_a_id"],
                 d["now_year"], d["now_month"])

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_supply_move_same_resource_same_project_blocked(client, finance_headers, move_setup):
    """Moving to same resource AND same project is rejected (400 validation error)."""
    d = move_setup

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_1_id"],
                        d["project_a_id"], d["project_a_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 400
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_supply_move_conflict_returns_409(client, finance_headers, move_setup):
    """If target resource+project already has supply in those periods, returns 409."""
    d = move_setup
    _make_supply(client, finance_headers, d["resource_1_id"], d["project_a_id"],
                 d["now_year"], d["now_month"])
    _make_supply(client, finance_headers, d["resource_2_id"], d["project_b_id"],
                 d["now_year"], d["now_month"], fte=30)

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "CONFLICT"


def test_supply_move_nonexistent_source_project_returns_404(client, finance_headers, move_setup):
    """If source project_id doesn't exist, returns 404."""
    d = move_setup

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        "00000000-0000-0000-0000-000000000000", d["project_b_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 404, resp.text
    # detail field contains the message in Problem Details format
    assert "project" in resp.json()["detail"].lower()
    assert "target" not in resp.json()["detail"].lower()


def test_supply_move_nonexistent_target_project_returns_404(client, finance_headers, move_setup):
    """If to_project_id doesn't exist, returns 404."""
    d = move_setup

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], "00000000-0000-0000-0000-000000000000",
                        [d["period_now_id"]])
    assert resp.status_code == 404, resp.text
    assert "target" in resp.json()["detail"].lower()


def test_supply_move_unauthorized_resource_returns_403(client, ro_headers, finance_headers, move_setup, db):
    """Manager without scope over the resource gets 403, not 404."""
    d = move_setup
    # Reset cc.ro_user_id so ro-001 has NO scope over these resources
    cc = db.query(CostCenter).filter(CostCenter.code == "CC-MOVE").first()
    cc.ro_user_id = None
    db.commit()

    resp = _move_supply(client, ro_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"


def test_supply_move_self_conflict_excluded(client, finance_headers, move_setup):
    """Moving same resource to different project doesn't falsely conflict with itself."""
    d = move_setup
    _make_supply(client, finance_headers, d["resource_1_id"], d["project_a_id"],
                 d["now_year"], d["now_month"])

    # Same resource, project_a → project_b: source row (res_1, proj_a) must NOT be
    # treated as a conflict against the target (res_1, proj_b)
    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_1_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_now_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_supply_move_multiple_periods(client, finance_headers, move_setup):
    """Moving supply across multiple periods succeeds."""
    d = move_setup
    for yr, mo in [(d["now_year"], d["now_month"]), (d["nxt_year"], d["nxt_month"])]:
        _make_supply(client, finance_headers, d["resource_1_id"], d["project_a_id"], yr, mo)

    resp = _move_supply(client, finance_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_now_id"], d["period_nxt_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 2


def test_supply_move_null_project_to_project(client, finance_headers, move_setup, db):
    """Moving a supply line that has no project_id (NULL) to a target project succeeds."""
    from api.app.models.planning import SupplyLine as SL
    d = move_setup

    # Insert a supply line with project_id = NULL directly (legacy data scenario)
    null_line = SL(
        tenant_id=TENANT,
        period_id=d["period_now_id"],
        resource_id=d["resource_1_id"],
        project_id=None,
        year=d["now_year"],
        month=d["now_month"],
        fte_percent=50,
        created_by="test",
    )
    db.add(null_line)
    db.commit()

    resp = client.post(
        "/supply-lines/group/move",
        json={
            "from_resource_id": d["resource_1_id"],
            "to_resource_id": d["resource_2_id"],
            # project_id omitted (null) — represents "no project" supply line
            "to_project_id": d["project_a_id"],
            "period_ids": [d["period_now_id"]],
        },
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


# ============== DEMAND MOVE TESTS ==============

def _make_demand(client, headers, project_id, resource_id, year, month, fte=50):
    resp = client.post(
        "/demand-lines",
        json={"project_id": project_id, "resource_id": resource_id,
              "year": year, "month": month, "fte_percent": fte},
        headers=headers,
    )
    assert resp.status_code == 200, f"Demand create failed: {resp.text}"
    return resp.json()


def _move_demand(client, headers, from_res, to_res, proj, to_proj, period_ids):
    return client.post(
        "/demand-lines/group/move",
        json={"from_resource_id": from_res, "to_resource_id": to_res,
              "project_id": proj, "to_project_id": to_proj,
              "period_ids": period_ids},
        headers=headers,
    )


def test_demand_move_different_resource_same_project(client, pm_headers, move_setup):
    """Move demand from resource_1 to resource_2, same project — succeeds."""
    d = move_setup
    _make_demand(client, pm_headers, d["project_a_id"], d["resource_1_id"],
                 d["nxt_year"], d["nxt_month"])

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_a_id"],
                        [d["period_nxt_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_demand_move_same_resource_different_project(client, pm_headers, move_setup):
    """Move demand to same resource but different project — succeeds."""
    d = move_setup
    _make_demand(client, pm_headers, d["project_a_id"], d["resource_1_id"],
                 d["nxt_year"], d["nxt_month"])

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_1_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_nxt_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_demand_move_different_resource_different_project(client, pm_headers, move_setup):
    """Move demand to different resource AND different project — succeeds."""
    d = move_setup
    _make_demand(client, pm_headers, d["project_a_id"], d["resource_1_id"],
                 d["nxt_year"], d["nxt_month"])

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_nxt_id"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1


def test_demand_move_same_resource_same_project_blocked(client, pm_headers, move_setup):
    """Moving to same resource AND same project is rejected (400 validation error)."""
    d = move_setup

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_1_id"],
                        d["project_a_id"], d["project_a_id"],
                        [d["period_nxt_id"]])
    assert resp.status_code == 400
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_demand_move_conflict_returns_409(client, pm_headers, move_setup):
    """If target resource+project already has demand in those periods, returns 409."""
    d = move_setup
    _make_demand(client, pm_headers, d["project_a_id"], d["resource_1_id"],
                 d["nxt_year"], d["nxt_month"])
    _make_demand(client, pm_headers, d["project_b_id"], d["resource_2_id"],
                 d["nxt_year"], d["nxt_month"], fte=30)

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], d["project_b_id"],
                        [d["period_nxt_id"]])
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "CONFLICT"


def test_demand_move_nonexistent_source_project_returns_404(client, pm_headers, move_setup):
    """If source project_id doesn't exist, returns 404."""
    d = move_setup

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        "00000000-0000-0000-0000-000000000000", d["project_b_id"],
                        [d["period_nxt_id"]])
    assert resp.status_code == 404, resp.text


def test_demand_move_nonexistent_target_project_returns_404(client, pm_headers, move_setup):
    """If to_project_id doesn't exist, returns 404."""
    d = move_setup

    resp = _move_demand(client, pm_headers,
                        d["resource_1_id"], d["resource_2_id"],
                        d["project_a_id"], "00000000-0000-0000-0000-000000000000",
                        [d["period_nxt_id"]])
    assert resp.status_code == 404, resp.text
    assert "target" in resp.json()["detail"].lower()
