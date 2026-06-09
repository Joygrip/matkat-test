"""Tests for group move/copy with selected period_ids.

Covers:
- operation="copy" creates target lines while leaving source unchanged
- operation="move" (default) retains existing behavior
- partial period_ids: only selected periods are affected
- cap confirmation works for both copy and move
- general availability supply (project_id=None / to_project_id=None)
- Manager+Reader cannot copy/move from or to out-of-scope resources
- Locked periods reject the whole operation
- PM authorization for demand copy/move
"""
import pytest
from datetime import datetime
from dateutil.relativedelta import relativedelta

from api.app.models.core import CostCenter, User, UserRole

TENANT = "test-tenant-001"
MANAGER_OID = "ro-001"           # matches ro_headers (X-Dev-User-Id)
MANAGER_READER_OID = "manager-reader-001"  # matches manager_reader_headers

PM_OID = "pm-001"                # matches pm_headers
PM_DB_ID = "pm-xfer-db-001"
OTHER_PM_OID = "pm-xfer-other"
OTHER_PM_HEADERS = {
    "X-Dev-Role": "PM",
    "X-Dev-Tenant": TENANT,
    "X-Dev-User-Id": OTHER_PM_OID,
    "X-Dev-Email": "pm-xfer-other@test.com",
    "X-Dev-Name": "Other PM Transfer",
}


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def transfer_setup(client, admin_headers, finance_headers, db):
    """
    Creates:
      - manager_user  (object_id=ro-001, ro_user_id of CC1)
      - mr_user       (object_id=manager-reader-001, no CC ownership here)
      - CC1           (managed by manager_user)
      - CC_other      (unrelated)
      - source_resource, target_resource  (both in CC1 → in-scope for manager)
      - out_scope_resource                (in CC_other → out-of-scope)
      - project1, project2
      - p1, p2, p3  (open periods: now, now+1, now+2)
      - p_lock       (now+3, locked)
    """
    # Manager user (matches ro_headers)
    manager_user = User(
        tenant_id=TENANT,
        object_id=MANAGER_OID,
        email="ro@test.com",
        display_name="Manager User",
        role=UserRole.MANAGER,
        is_active=True,
    )
    # Manager+Reader user (matches manager_reader_headers)
    mr_user = User(
        tenant_id=TENANT,
        object_id=MANAGER_READER_OID,
        email="manager.reader@test.com",
        display_name="Manager Reader",
        role=UserRole.MANAGER,
        secondary_role="Reader",
        is_active=True,
    )
    db.add_all([manager_user, mr_user])
    db.commit()
    db.refresh(manager_user)

    # CC1 — owned by manager
    cc1_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-XFR1", "name": "Transfer CC1"},
        headers=admin_headers,
    )
    cc1_id = cc1_resp.json()["id"]
    cc1 = db.query(CostCenter).filter(CostCenter.id == cc1_id).first()
    cc1.ro_user_id = manager_user.id
    db.commit()

    # CC_other — unrelated
    cc_other_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-XOTHER", "name": "Transfer CC Other"},
        headers=admin_headers,
    )
    cc_other_id = cc_other_resp.json()["id"]

    # Resources
    src_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc1_id, "employee_id": "EMP-XSR", "display_name": "Source Employee"},
        headers=admin_headers,
    )
    source_resource_id = src_resp.json()["id"]

    tgt_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc1_id, "employee_id": "EMP-XTG", "display_name": "Target Employee"},
        headers=admin_headers,
    )
    target_resource_id = tgt_resp.json()["id"]

    out_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_other_id, "employee_id": "EMP-XOUT", "display_name": "OutScope Employee"},
        headers=admin_headers,
    )
    out_scope_resource_id = out_resp.json()["id"]

    # Projects
    proj1_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-XFR1", "name": "Transfer Project 1"},
        headers=admin_headers,
    )
    project1_id = proj1_resp.json()["id"]

    proj2_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-XFR2", "name": "Transfer Project 2"},
        headers=admin_headers,
    )
    project2_id = proj2_resp.json()["id"]

    # Periods: now, now+1, now+2 (open) + now+3 (to be locked)
    now = datetime.utcnow()
    months = [now + relativedelta(months=i) for i in range(4)]
    for mo in months:
        client.post("/periods", json={"year": mo.year, "month": mo.month}, headers=finance_headers)

    periods_resp = client.get("/periods", headers=finance_headers)
    pmap = {(p["year"], p["month"]): p for p in periods_resp.json()}

    p_ids = [pmap[(mo.year, mo.month)]["id"] for mo in months]
    p_lock_id = p_ids[3]

    # Lock the fourth period
    client.post(f"/periods/{p_lock_id}/lock", headers=finance_headers)

    return {
        "source_resource_id": source_resource_id,
        "target_resource_id": target_resource_id,
        "out_scope_resource_id": out_scope_resource_id,
        "project1_id": project1_id,
        "project2_id": project2_id,
        # open periods
        "p1_id": p_ids[0], "p1_year": months[0].year, "p1_month": months[0].month,
        "p2_id": p_ids[1], "p2_year": months[1].year, "p2_month": months[1].month,
        "p3_id": p_ids[2], "p3_year": months[2].year, "p3_month": months[2].month,
        # locked period
        "p_lock_id": p_lock_id,
        "p_lock_year": months[3].year,
        "p_lock_month": months[3].month,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_supply(client, headers, resource_id, project_id, year, month, fte):
    resp = client.post(
        "/supply-lines",
        json={"resource_id": resource_id, "project_id": project_id, "year": year, "month": month, "fte_percent": fte},
        headers=headers,
    )
    assert resp.status_code == 200, f"Supply create failed: {resp.text}"
    return resp.json()["id"]


def _create_demand(client, headers, project_id, resource_id, year, month, fte):
    resp = client.post(
        "/demand-lines",
        json={"project_id": project_id, "resource_id": resource_id, "year": year, "month": month, "fte_percent": fte},
        headers=headers,
    )
    assert resp.status_code == 200, f"Demand create failed: {resp.text}"
    return resp.json()["id"]


def _supply_exists(client, headers, resource_id, project_id, year, month):
    resp = client.get(f"/supply-lines?year={year}&month={month}&resource_id={resource_id}", headers=headers)
    lines = resp.json()
    for line in lines:
        if line["resource_id"] == resource_id and line["project_id"] == project_id:
            return line
    return None


def _demand_exists(client, headers, project_id, resource_id, year, month):
    resp = client.get(f"/demand-lines?year={year}&month={month}&project_id={project_id}&resource_id={resource_id}", headers=headers)
    lines = resp.json()
    return lines[0] if lines else None


# ===========================================================================
# SUPPLY TESTS
# ===========================================================================

class TestSupplyTransfer:

    def test_default_operation_is_move(self, client, ro_headers, finance_headers, transfer_setup):
        """Omitting operation field → moves (backward compatibility)."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project1_id"],
            "period_ids": [d["p1_id"]],
        }, headers=ro_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        # Source deleted
        assert _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"],
                               d["p1_year"], d["p1_month"]) is None
        # Target created
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], d["project1_id"],
                              d["p1_year"], d["p1_month"])
        assert tgt is not None
        assert tgt["fte_percent"] == 50

    def test_supply_copy_subset_creates_target_leaves_source(self, client, ro_headers, finance_headers, transfer_setup):
        """Copy only periods p1 and p2 of p1/p2/p3 — source unchanged, target gets p1+p2 only."""
        d = transfer_setup
        for pid, y, m in [
            (d["p1_id"], d["p1_year"], d["p1_month"]),
            (d["p2_id"], d["p2_year"], d["p2_month"]),
            (d["p3_id"], d["p3_year"], d["p3_month"]),
        ]:
            _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], y, m, 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"], d["p2_id"]],
            "operation": "copy",
        }, headers=ro_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 2

        # Source lines all still exist
        for y, m in [(d["p1_year"], d["p1_month"]), (d["p2_year"], d["p2_month"]), (d["p3_year"], d["p3_month"])]:
            src = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], y, m)
            assert src is not None, f"Source line missing for {y}-{m}"
            assert src["fte_percent"] == 50

        # Target has p1 and p2 only
        tgt1 = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"])
        tgt2 = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"])
        tgt3 = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p3_year"], d["p3_month"])
        assert tgt1 is not None and tgt1["fte_percent"] == 50
        assert tgt2 is not None and tgt2["fte_percent"] == 50
        assert tgt3 is None

    def test_supply_move_subset_moves_only_selected(self, client, ro_headers, finance_headers, transfer_setup):
        """Move only p1 and p2 of p1/p2/p3 — source keeps p3, target gets p1+p2."""
        d = transfer_setup
        for y, m in [(d["p1_year"], d["p1_month"]), (d["p2_year"], d["p2_month"]), (d["p3_year"], d["p3_month"])]:
            _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], y, m, 40)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"], d["p2_id"]],
            "operation": "move",
        }, headers=ro_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 2

        # Source p1, p2 deleted; p3 still present
        assert _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"]) is None
        assert _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"]) is None
        src3 = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p3_year"], d["p3_month"])
        assert src3 is not None and src3["fte_percent"] == 40

        # Target has p1 and p2
        assert _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"]) is not None
        assert _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"]) is not None

    def test_supply_copy_merges_existing_target(self, client, ro_headers, finance_headers, transfer_setup):
        """Copy into a target that already has 30% — result is 70%, source unchanged."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 40)
        _create_supply(client, ro_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"], 30)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=ro_headers)
        assert resp.status_code == 200

        # Source still 40%
        src = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"])
        assert src is not None and src["fte_percent"] == 40

        # Target now 70%
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"])
        assert tgt is not None and tgt["fte_percent"] == 70

    def test_supply_copy_cap_confirmation_no_mutation(self, client, ro_headers, finance_headers, transfer_setup):
        """Copy would exceed 100% — returns 409, no DB mutation."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 70)
        _create_supply(client, ro_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=ro_headers)
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "MOVE_REQUIRES_CAP_CONFIRMATION"
        assert len(body["periods"]) == 1
        assert body["periods"][0]["raw_total"] == 130
        assert body["periods"][0]["capped_total"] == 100

        # Source and target completely unchanged
        src = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"])
        assert src["fte_percent"] == 70
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"])
        assert tgt["fte_percent"] == 60

    def test_supply_copy_confirm_cap_true(self, client, ro_headers, finance_headers, transfer_setup):
        """confirm_cap=true caps merged value to 100 and commits."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 70)
        _create_supply(client, ro_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "confirm_cap": True,
        }, headers=ro_headers)
        assert resp.status_code == 200

        # Source still 70%, target capped to 100%
        src = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"])
        assert src["fte_percent"] == 70
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"])
        assert tgt["fte_percent"] == 100

    def test_supply_move_confirm_cap_true(self, client, ro_headers, finance_headers, transfer_setup):
        """confirm_cap=true on move: source deleted, target capped to 100."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 70)
        _create_supply(client, ro_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "confirm_cap": True,
        }, headers=ro_headers)
        assert resp.status_code == 200

        assert _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"]) is None
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"])
        assert tgt["fte_percent"] == 100

    def test_supply_copy_general_availability_source(self, client, ro_headers, finance_headers, transfer_setup):
        """Copy from a general availability supply (project_id=None)."""
        d = transfer_setup
        # Create source with no project (general availability)
        _create_supply(client, ro_headers, d["source_resource_id"], None, d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": None,
            "to_project_id": d["project1_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=ro_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        # Source general availability still present
        src = _supply_exists(client, finance_headers, d["source_resource_id"], None, d["p1_year"], d["p1_month"])
        assert src is not None and src["fte_percent"] == 50

        # Target has project-specific line
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"])
        assert tgt is not None and tgt["fte_percent"] == 50

    def test_supply_copy_general_availability_target(self, client, ro_headers, finance_headers, transfer_setup):
        """Copy to a general availability target (to_project_id=None)."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": None,
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=ro_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        # Source project-specific still present
        src = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"])
        assert src is not None and src["fte_percent"] == 50

        # Target general availability created
        tgt = _supply_exists(client, finance_headers, d["target_resource_id"], None, d["p1_year"], d["p1_month"])
        assert tgt is not None and tgt["fte_percent"] == 50

    def test_manager_reader_cannot_copy_from_out_of_scope_source(
        self, client, manager_reader_headers, finance_headers, transfer_setup
    ):
        """Manager+Reader blocked when source resource is outside write scope."""
        d = transfer_setup
        # Finance creates supply for the out-of-scope source resource
        _create_supply(client, finance_headers, d["out_scope_resource_id"], d["project1_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["out_scope_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=manager_reader_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"

    def test_manager_reader_cannot_copy_to_out_of_scope_target(
        self, client, manager_reader_headers, ro_headers, finance_headers, transfer_setup
    ):
        """Manager+Reader blocked when target resource is outside write scope."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["out_scope_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=manager_reader_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"

    def test_manager_reader_cannot_move_out_of_scope(
        self, client, manager_reader_headers, finance_headers, transfer_setup
    ):
        """Manager+Reader blocked on move from out-of-scope source (default operation)."""
        d = transfer_setup
        _create_supply(client, finance_headers, d["out_scope_resource_id"], d["project1_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["out_scope_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
        }, headers=manager_reader_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"

    def test_locked_period_rejects_copy(self, client, ro_headers, finance_headers, transfer_setup):
        """Including a locked period in period_ids rejects the entire copy operation.

        The service validates ALL period locks before any data lookup, so even without
        a source line in the locked period the request is rejected.
        """
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"], d["p_lock_id"]],
            "operation": "copy",
        }, headers=ro_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PERIOD_LOCKED"

        # Source untouched — all-or-nothing guarantee
        src = _supply_exists(client, finance_headers, d["source_resource_id"], d["project1_id"],
                              d["p1_year"], d["p1_month"])
        assert src is not None and src["fte_percent"] == 50

    def test_finance_can_copy_supply(self, client, finance_headers, transfer_setup):
        """Finance can execute a supply copy."""
        d = transfer_setup
        _create_supply(client, finance_headers, d["source_resource_id"], d["project1_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=finance_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1


# ===========================================================================
# DEMAND TESTS
# ===========================================================================

PM_DB_ID_DEMAND = "pm-xfer-db-001"

@pytest.fixture
def demand_transfer_setup(client, admin_headers, finance_headers, db, transfer_setup):
    """Extends transfer_setup with PM user and PM-assigned / unassigned projects."""
    d = transfer_setup

    pm_user = User(
        id=PM_DB_ID_DEMAND,
        tenant_id=TENANT,
        object_id=PM_OID,
        email="pm@test.com",
        display_name="PM User",
        role=UserRole.PM,
    )
    other_pm_user = User(
        tenant_id=TENANT,
        object_id=OTHER_PM_OID,
        email="pm-xfer-other@test.com",
        display_name="Other PM",
        role=UserRole.PM,
    )
    db.add_all([pm_user, other_pm_user])
    db.commit()

    # Reassign project1 to have PM_DB_ID_DEMAND as assigned PM
    proj_assigned_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-PMXFR1", "name": "PM Assigned Project", "pm_user_ids": [PM_DB_ID_DEMAND]},
        headers=admin_headers,
    )
    pm_proj_id = proj_assigned_resp.json()["id"]

    # A project with no PM assigned (any PM can manage)
    proj_open_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-PMXFR2", "name": "PM Open Project"},
        headers=admin_headers,
    )
    pm_open_proj_id = proj_open_resp.json()["id"]

    return {**d, "pm_proj_id": pm_proj_id, "pm_open_proj_id": pm_open_proj_id}


class TestDemandTransfer:

    def test_default_operation_is_move(self, client, pm_headers, finance_headers, demand_transfer_setup):
        """Omitting operation field → moves demand (backward compatibility)."""
        d = demand_transfer_setup
        _create_demand(client, pm_headers, d["pm_open_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"]],
        }, headers=pm_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        # Source deleted
        assert _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"],
                               d["p1_year"], d["p1_month"]) is None
        # Target created
        tgt = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["target_resource_id"],
                              d["p1_year"], d["p1_month"])
        assert tgt is not None and tgt["fte_percent"] == 50

    def test_demand_copy_subset_creates_target_leaves_source(
        self, client, pm_headers, finance_headers, demand_transfer_setup
    ):
        """Copy selected demand periods — source unchanged, target gets only selected."""
        d = demand_transfer_setup
        for y, m in [(d["p1_year"], d["p1_month"]), (d["p2_year"], d["p2_month"]), (d["p3_year"], d["p3_month"])]:
            _create_demand(client, pm_headers, d["pm_open_proj_id"], d["source_resource_id"], y, m, 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"], d["p2_id"]],
            "operation": "copy",
        }, headers=pm_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 2

        # Source all present
        for y, m in [(d["p1_year"], d["p1_month"]), (d["p2_year"], d["p2_month"]), (d["p3_year"], d["p3_month"])]:
            src = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], y, m)
            assert src is not None, f"Source missing for {y}-{m}"

        # Target has p1, p2; not p3
        assert _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["target_resource_id"], d["p1_year"], d["p1_month"]) is not None
        assert _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["target_resource_id"], d["p2_year"], d["p2_month"]) is not None
        assert _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["target_resource_id"], d["p3_year"], d["p3_month"]) is None

    def test_demand_move_subset_moves_only_selected(
        self, client, pm_headers, finance_headers, demand_transfer_setup
    ):
        """Move selected demand periods — unselected source period remains."""
        d = demand_transfer_setup
        for y, m in [(d["p1_year"], d["p1_month"]), (d["p2_year"], d["p2_month"]), (d["p3_year"], d["p3_month"])]:
            _create_demand(client, pm_headers, d["pm_open_proj_id"], d["source_resource_id"], y, m, 40)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"], d["p2_id"]],
            "operation": "move",
        }, headers=pm_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 2

        # Source p1, p2 deleted; p3 still present
        assert _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], d["p1_year"], d["p1_month"]) is None
        assert _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], d["p2_year"], d["p2_month"]) is None
        src3 = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], d["p3_year"], d["p3_month"])
        assert src3 is not None and src3["fte_percent"] == 40

    def test_demand_copy_cap_confirmation_no_mutation(
        self, client, pm_headers, finance_headers, demand_transfer_setup
    ):
        """Demand copy returns 409 when merged would exceed 100%, no mutation."""
        d = demand_transfer_setup
        _create_demand(client, pm_headers, d["pm_open_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 70)
        _create_demand(client, pm_headers, d["pm_open_proj_id"], d["target_resource_id"],
                       d["p1_year"], d["p1_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=pm_headers)
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "MOVE_REQUIRES_CAP_CONFIRMATION"

        # No mutations
        src = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], d["p1_year"], d["p1_month"])
        assert src["fte_percent"] == 70
        tgt = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["target_resource_id"], d["p1_year"], d["p1_month"])
        assert tgt["fte_percent"] == 60

    def test_demand_copy_confirm_cap_true(
        self, client, pm_headers, finance_headers, demand_transfer_setup
    ):
        """confirm_cap=true caps demand copy to 100, source unchanged."""
        d = demand_transfer_setup
        _create_demand(client, pm_headers, d["pm_open_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 70)
        _create_demand(client, pm_headers, d["pm_open_proj_id"], d["target_resource_id"],
                       d["p1_year"], d["p1_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "confirm_cap": True,
        }, headers=pm_headers)
        assert resp.status_code == 200

        src = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], d["p1_year"], d["p1_month"])
        assert src["fte_percent"] == 70
        tgt = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["target_resource_id"], d["p1_year"], d["p1_month"])
        assert tgt["fte_percent"] == 100

    def test_demand_pm_unauthorized_source_project(
        self, client, finance_headers, demand_transfer_setup
    ):
        """PM not assigned to source project is rejected for copy."""
        d = demand_transfer_setup
        # Finance creates demand on the PM-assigned project
        _create_demand(client, finance_headers, d["pm_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=OTHER_PM_HEADERS)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PM_NOT_AUTHORIZED"

    def test_demand_pm_unauthorized_target_project(
        self, client, pm_headers, finance_headers, demand_transfer_setup
    ):
        """PM not assigned to target project is rejected for copy."""
        d = demand_transfer_setup
        _create_demand(client, pm_headers, d["pm_open_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_proj_id"],  # assigned only to PM_DB_ID_DEMAND (pm-001)
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=OTHER_PM_HEADERS)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PM_NOT_AUTHORIZED"

    def test_demand_finance_can_copy(self, client, finance_headers, demand_transfer_setup):
        """Finance can copy demand regardless of PM assignment."""
        d = demand_transfer_setup
        _create_demand(client, finance_headers, d["pm_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=finance_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        # Source still present
        src = _demand_exists(client, finance_headers, d["pm_proj_id"], d["source_resource_id"], d["p1_year"], d["p1_month"])
        assert src is not None and src["fte_percent"] == 50

    def test_demand_locked_period_rejects_copy(self, client, finance_headers, demand_transfer_setup):
        """Demand copy with a locked period rejects the whole operation."""
        d = demand_transfer_setup
        _create_demand(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_open_proj_id"],
            "to_project_id": d["pm_open_proj_id"],
            "period_ids": [d["p1_id"], d["p_lock_id"]],
            "operation": "copy",
        }, headers=finance_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PERIOD_LOCKED"

        # Source untouched
        src = _demand_exists(client, finance_headers, d["pm_open_proj_id"], d["source_resource_id"], d["p1_year"], d["p1_month"])
        assert src is not None

    def test_demand_assigned_pm_can_copy(self, client, pm_headers, finance_headers, demand_transfer_setup):
        """Assigned PM can copy demand for their own project."""
        d = demand_transfer_setup
        _create_demand(client, finance_headers, d["pm_proj_id"], d["source_resource_id"],
                       d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["pm_proj_id"],
            "to_project_id": d["pm_proj_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
        }, headers=pm_headers)
        assert resp.status_code == 200

        src = _demand_exists(client, finance_headers, d["pm_proj_id"], d["source_resource_id"], d["p1_year"], d["p1_month"])
        assert src is not None and src["fte_percent"] == 50
        tgt = _demand_exists(client, finance_headers, d["pm_proj_id"], d["target_resource_id"], d["p1_year"], d["p1_month"])
        assert tgt is not None and tgt["fte_percent"] == 50


# ===========================================================================
# MAPPED TRANSFER TESTS  (period_mappings + merge_mode)
# ===========================================================================

def _supply_at(client, headers, resource_id, project_id, year, month):
    """Return supply line dict for given identity+period, or None."""
    resp = client.get(f"/supply-lines?year={year}&month={month}&resource_id={resource_id}", headers=headers)
    for line in resp.json():
        if line["resource_id"] == resource_id and line["project_id"] == project_id:
            return line
    return None


def _demand_at(client, headers, project_id, resource_id, year, month):
    resp = client.get(f"/demand-lines?year={year}&month={month}&project_id={project_id}&resource_id={resource_id}", headers=headers)
    lines = resp.json()
    return lines[0] if lines else None


class TestMappedTransferSupply:
    """Tests for supply group move/copy with period_mappings."""

    def test_mapped_replace_copy_shifted_one_month(self, client, ro_headers, finance_headers, transfer_setup):
        """Copy p1→p2, p2→p3 with replace mode: source unchanged, target gets shifted values."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],  # required by schema; ignored when period_mappings present
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
            ],
        }, headers=ro_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["moved"] == 2

        # Source unchanged
        assert _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"])["fte_percent"] == 50
        assert _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"])["fte_percent"] == 60

        # Target shifted: p2=50 (from source p1), p3=60 (from source p2)
        tgt_p2 = _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"])
        tgt_p3 = _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p3_year"], d["p3_month"])
        assert tgt_p2 is not None and tgt_p2["fte_percent"] == 50
        assert tgt_p3 is not None and tgt_p3["fte_percent"] == 60

        # No target at p1
        assert _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"]) is None

    def test_mapped_replace_move_shifted_cross_resource(self, client, ro_headers, finance_headers, transfer_setup):
        """Move p1→p2, p2→p3 cross-resource: both source lines deleted, target shifted."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
            ],
        }, headers=ro_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["moved"] == 2

        # Both source lines deleted (cross-identity move)
        assert _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"]) is None
        assert _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"]) is None

        # Target shifted
        assert _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"])["fte_percent"] == 50
        assert _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p3_year"], d["p3_month"])["fte_percent"] == 60

    def test_mapped_move_self_shift_same_resource_project(self, client, ro_headers, finance_headers, transfer_setup):
        """Same resource+project self-shift: only the source-only period is deleted."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["source_resource_id"],   # same resource
            "project_id": d["project1_id"],
            "to_project_id": d["project1_id"],            # same project
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
            ],
        }, headers=ro_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["moved"] == 2

        # p1 deleted (source-only)
        assert _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"]) is None
        # p2 updated in-place to source_p1 value (50); p3 created with source_p2 value (60)
        p2 = _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"])
        p3 = _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p3_year"], d["p3_month"])
        assert p2 is not None and p2["fte_percent"] == 50
        assert p3 is not None and p3["fte_percent"] == 60

    def test_snapshot_prevents_stale_reads_on_overlap(self, client, ro_headers, finance_headers, transfer_setup):
        """Verify snapshot: p2→p3, p3→p2 swap uses original values, not live-written values."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"], 40)
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p3_year"], d["p3_month"], 70)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["source_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project1_id"],
            "period_ids": [d["p2_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
                {"from_period_id": d["p3_id"], "to_period_id": d["p2_id"]},
            ],
        }, headers=ro_headers)
        assert resp.status_code == 200, resp.text

        # Swap: p2 should have original p3 value (70), p3 should have original p2 value (40)
        p2 = _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p2_year"], d["p2_month"])
        p3 = _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p3_year"], d["p3_month"])
        assert p2 is not None and p2["fte_percent"] == 70
        assert p3 is not None and p3["fte_percent"] == 40

    def test_mapped_to_null_project_general_availability(self, client, ro_headers, finance_headers, transfer_setup):
        """Mapped copy to to_project_id=None (general availability) succeeds."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": None,
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
            ],
        }, headers=ro_headers)
        assert resp.status_code == 200, resp.text

        tgt = _supply_at(client, finance_headers, d["target_resource_id"], None, d["p2_year"], d["p2_month"])
        assert tgt is not None and tgt["fte_percent"] == 50

    def test_mapped_manager_auth_enforced(self, client, manager_reader_headers, finance_headers, transfer_setup):
        """Manager+Reader blocked from mapped move to out-of-scope target."""
        d = transfer_setup
        _create_supply(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["out_scope_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]}],
        }, headers=manager_reader_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"

    def test_mapped_locked_source_period_rejected(self, client, ro_headers, finance_headers, transfer_setup):
        """Locked period in from_period_ids rejects the entire operation."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p_lock_id"], "to_period_id": d["p1_id"]}],
        }, headers=ro_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PERIOD_LOCKED"

    def test_mapped_locked_target_period_rejected(self, client, ro_headers, finance_headers, transfer_setup):
        """Locked period in to_period_ids rejects the entire operation."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p_lock_id"]}],
        }, headers=ro_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PERIOD_LOCKED"

    def test_mapped_unknown_period_rejected(self, client, ro_headers, transfer_setup):
        """Non-existent period ID in period_mappings returns 404."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": "00000000-0000-0000-0000-000000000000"}],
        }, headers=ro_headers)
        assert resp.status_code == 404

    def test_mapped_add_mode_cap_confirmation(self, client, ro_headers, finance_headers, transfer_setup):
        """Mapped add mode: exceeding 100% returns 409 with target period IDs."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 70)
        _create_supply(client, ro_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "add",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]}],
        }, headers=ro_headers)
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "MOVE_REQUIRES_CAP_CONFIRMATION"
        assert len(body["periods"]) == 1
        assert body["periods"][0]["period_id"] == d["p2_id"]  # target period, not source
        assert body["periods"][0]["raw_total"] == 130

    def test_mapped_add_mode_confirm_cap(self, client, ro_headers, finance_headers, transfer_setup):
        """Mapped add mode with confirm_cap=True caps at 100 and commits."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 70)
        _create_supply(client, ro_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "add",
            "confirm_cap": True,
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]}],
        }, headers=ro_headers)
        assert resp.status_code == 200, resp.text

        tgt = _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p2_year"], d["p2_month"])
        assert tgt["fte_percent"] == 100

    def test_period_mappings_absent_keeps_old_behavior(self, client, ro_headers, finance_headers, transfer_setup):
        """period_mappings absent → existing period_ids path unchanged."""
        d = transfer_setup
        _create_supply(client, ro_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/supply-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
        }, headers=ro_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        assert _supply_at(client, finance_headers, d["source_resource_id"], d["project1_id"], d["p1_year"], d["p1_month"]) is None
        assert _supply_at(client, finance_headers, d["target_resource_id"], d["project2_id"], d["p1_year"], d["p1_month"]) is not None


class TestMappedTransferDemand:
    """Tests for demand group move/copy with period_mappings."""

    def test_mapped_replace_copy_shifted(self, client, finance_headers, transfer_setup):
        """Demand: copy p1→p2, p2→p3 with replace: source unchanged, target shifted."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
            ],
        }, headers=finance_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["moved"] == 2

        # Source unchanged
        assert _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"])["fte_percent"] == 50
        assert _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"])["fte_percent"] == 60

        # Target shifted
        tgt_p2 = _demand_at(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p2_year"], d["p2_month"])
        tgt_p3 = _demand_at(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p3_year"], d["p3_month"])
        assert tgt_p2 is not None and tgt_p2["fte_percent"] == 50
        assert tgt_p3 is not None and tgt_p3["fte_percent"] == 60

    def test_mapped_replace_move_shifted_cross_resource(self, client, finance_headers, transfer_setup):
        """Demand: move p1→p2, p2→p3 cross-resource: all source lines deleted."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
            ],
        }, headers=finance_headers)
        assert resp.status_code == 200, resp.text

        # Both source lines gone
        assert _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"]) is None
        assert _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"]) is None

        # Target shifted
        assert _demand_at(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p2_year"], d["p2_month"])["fte_percent"] == 50
        assert _demand_at(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p3_year"], d["p3_month"])["fte_percent"] == 60

    def test_demand_mapped_move_self_shift(self, client, finance_headers, transfer_setup):
        """Demand self-shift: same resource+project, source-only period deleted."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["source_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project1_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]},
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
            ],
        }, headers=finance_headers)
        assert resp.status_code == 200, resp.text

        assert _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"]) is None
        p2 = _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"])
        p3 = _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p3_year"], d["p3_month"])
        assert p2["fte_percent"] == 50
        assert p3["fte_percent"] == 60

    def test_demand_mapped_snapshot_swap(self, client, finance_headers, transfer_setup):
        """Demand swap p2↔p3 uses snapshot; both updated to swapped values."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"], 40)
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p3_year"], d["p3_month"], 70)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["source_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project1_id"],
            "period_ids": [d["p2_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [
                {"from_period_id": d["p2_id"], "to_period_id": d["p3_id"]},
                {"from_period_id": d["p3_id"], "to_period_id": d["p2_id"]},
            ],
        }, headers=finance_headers)
        assert resp.status_code == 200, resp.text

        p2 = _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p2_year"], d["p2_month"])
        p3 = _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p3_year"], d["p3_month"])
        assert p2["fte_percent"] == 70   # original p3 value
        assert p3["fte_percent"] == 40   # original p2 value

    def test_demand_mapped_locked_source_rejected(self, client, finance_headers, transfer_setup):
        """Locked period in from_period_ids rejects demand mapped operation."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p_lock_id"], "to_period_id": d["p1_id"]}],
        }, headers=finance_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PERIOD_LOCKED"

    def test_demand_mapped_locked_target_rejected(self, client, finance_headers, transfer_setup):
        """Locked period in to_period_ids rejects demand mapped operation."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p_lock_id"]}],
        }, headers=finance_headers)
        assert resp.status_code == 403
        assert resp.json()["code"] == "PERIOD_LOCKED"

    def test_demand_mapped_unknown_period_rejected(self, client, finance_headers, transfer_setup):
        """Non-existent to_period_id returns 404."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "replace",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": "00000000-0000-0000-0000-000000000000"}],
        }, headers=finance_headers)
        assert resp.status_code == 404

    def test_demand_mapped_add_mode_cap_confirmation(self, client, finance_headers, transfer_setup):
        """Demand mapped add mode: over-100 returns 409 with target period ID."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 70)
        _create_demand(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "add",
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]}],
        }, headers=finance_headers)
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "MOVE_REQUIRES_CAP_CONFIRMATION"
        assert body["periods"][0]["period_id"] == d["p2_id"]
        assert body["periods"][0]["raw_total"] == 130

    def test_demand_mapped_add_confirm_cap(self, client, finance_headers, transfer_setup):
        """Demand mapped add with confirm_cap=True caps at 100."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 70)
        _create_demand(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p2_year"], d["p2_month"], 60)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "copy",
            "merge_mode": "add",
            "confirm_cap": True,
            "period_mappings": [{"from_period_id": d["p1_id"], "to_period_id": d["p2_id"]}],
        }, headers=finance_headers)
        assert resp.status_code == 200, resp.text

        tgt = _demand_at(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p2_year"], d["p2_month"])
        assert tgt["fte_percent"] == 100

    def test_demand_period_mappings_absent_keeps_old_behavior(self, client, finance_headers, transfer_setup):
        """No period_mappings → existing period_ids path unchanged for demand."""
        d = transfer_setup
        _create_demand(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"], 50)

        resp = client.post("/demand-lines/group/move", json={
            "from_resource_id": d["source_resource_id"],
            "to_resource_id": d["target_resource_id"],
            "project_id": d["project1_id"],
            "to_project_id": d["project2_id"],
            "period_ids": [d["p1_id"]],
            "operation": "move",
        }, headers=finance_headers)
        assert resp.status_code == 200
        assert resp.json()["moved"] == 1

        assert _demand_at(client, finance_headers, d["project1_id"], d["source_resource_id"], d["p1_year"], d["p1_month"]) is None
        assert _demand_at(client, finance_headers, d["project2_id"], d["target_resource_id"], d["p1_year"], d["p1_month"]) is not None
