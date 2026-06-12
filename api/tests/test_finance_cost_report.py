"""Tests for finance settings and period-specific monthly FTE cost behavior."""

from api.app.models.core import CostCenter, Project, Resource
from api.app.models.planning import DemandLine


def _create_demand_fixture(db, tenant_id: str, period_id: str, year: int, month: int, suffix: str, fte_percent: int = 50):
    cc = CostCenter(id=f"cc-{suffix}", tenant_id=tenant_id, code=f"CC{suffix}", name=f"Cost Center {suffix}")
    project = Project(id=f"proj-{suffix}", tenant_id=tenant_id, code=f"PRJ{suffix}", name=f"Project {suffix}")
    resource = Resource(
        id=f"res-{suffix}",
        tenant_id=tenant_id,
        cost_center_id=cc.id,
        employee_id=f"EMP-{suffix}",
        display_name=f"Resource {suffix}",
    )
    demand = DemandLine(
        id=f"dem-{suffix}",
        tenant_id=tenant_id,
        period_id=period_id,
        project_id=project.id,
        resource_id=resource.id,
        year=year,
        month=month,
        fte_percent=fte_percent,
        created_by="finance-001",
    )
    db.add_all([cc, project, resource, demand])
    db.commit()
    return {
        "cost_center_id": cc.id,
        "project_id": project.id,
        "resource_id": resource.id,
    }


# Pure formula sanity checks

def test_formula_math():
    assert round((50 / 100) * 99000) == 49500


def test_formula_math_full_fte():
    assert round((100 / 100) * 99000) == 99000


def test_formula_math_zero_fte():
    assert round((0 / 100) * 99000) == 0


# Settings endpoint behavior

def test_get_setting_default_for_finance(client, finance_headers):
    res = client.get("/finance/settings/monthly_fte_cost", headers=finance_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["setting_key"] == "monthly_fte_cost"
    assert data["setting_value"] == "99000"


def test_get_setting_with_period_id_returns_period_value(client, finance_headers):
    create = client.post("/periods", json={"year": 2027, "month": 1}, headers=finance_headers)
    period_id = create.json()["id"]

    upd = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={period_id}",
        json={"setting_value": "111000"},
        headers=finance_headers,
    )
    assert upd.status_code == 200

    got = client.get(f"/finance/settings/monthly_fte_cost?period_id={period_id}", headers=finance_headers)
    assert got.status_code == 200
    assert got.json()["setting_value"] == "111000"


def test_put_setting_with_period_id_updates_only_target_period(client, finance_headers):
    p1 = client.post("/periods", json={"year": 2027, "month": 2}, headers=finance_headers).json()
    p2 = client.post("/periods", json={"year": 2027, "month": 3}, headers=finance_headers).json()

    res = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={p2['id']}",
        json={"setting_value": "150000"},
        headers=finance_headers,
    )
    assert res.status_code == 200

    p1_get = client.get(f"/finance/settings/monthly_fte_cost?period_id={p1['id']}", headers=finance_headers)
    p2_get = client.get(f"/finance/settings/monthly_fte_cost?period_id={p2['id']}", headers=finance_headers)
    assert p1_get.status_code == 200
    assert p2_get.status_code == 200
    assert p1_get.json()["setting_value"] != p2_get.json()["setting_value"]
    assert p2_get.json()["setting_value"] == "150000"


def test_put_setting_locked_period_rejected_for_finance(client, finance_headers):
    period = client.post("/periods", json={"year": 2027, "month": 4}, headers=finance_headers).json()
    lock = client.post(f"/periods/{period['id']}/lock", headers=finance_headers)
    assert lock.status_code == 200

    res = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={period['id']}",
        json={"setting_value": "160000"},
        headers=finance_headers,
    )
    assert res.status_code == 403
    detail = res.json().get("detail", {})
    if isinstance(detail, dict):
        assert detail.get("message") == "Monthly FTE cost is frozen for locked periods."


def test_put_setting_locked_period_rejected_for_admin(client, finance_headers, admin_headers):
    period = client.post("/periods", json={"year": 2027, "month": 5}, headers=finance_headers).json()
    lock = client.post(f"/periods/{period['id']}/lock", headers=finance_headers)
    assert lock.status_code == 200

    res = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={period['id']}",
        json={"setting_value": "170000"},
        headers=admin_headers,
    )
    assert res.status_code == 403


def test_non_monthly_setting_behavior_unchanged(client, finance_headers):
    put = client.put(
        "/finance/settings/custom_finance_flag",
        json={"setting_value": "enabled"},
        headers=finance_headers,
    )
    assert put.status_code == 200
    assert put.json()["setting_value"] == "enabled"

    get = client.get("/finance/settings/custom_finance_flag", headers=finance_headers)
    assert get.status_code == 200
    assert get.json()["setting_value"] == "enabled"


# Calculation behavior

def test_consolidated_costs_single_period_uses_period_rate(client, db, finance_headers):
    period = client.post("/periods", json={"year": 2027, "month": 6}, headers=finance_headers).json()
    set_rate = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={period['id']}",
        json={"setting_value": "100000"},
        headers=finance_headers,
    )
    assert set_rate.status_code == 200

    fixture = _create_demand_fixture(db, "test-tenant-001", period["id"], 2027, 6, "single", fte_percent=50)

    res = client.get("/finance/consolidated-costs?year=2027&month=6", headers=finance_headers)
    assert res.status_code == 200
    rows = res.json()["data"]
    target = [r for r in rows if r["project_id"] == fixture["project_id"] and r["month"] == 6][0]
    assert target["demand_cost"] == 50000


def test_consolidated_detail_single_period_uses_period_rate(client, db, finance_headers):
    period = client.post("/periods", json={"year": 2027, "month": 7}, headers=finance_headers).json()
    set_rate = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={period['id']}",
        json={"setting_value": "120000"},
        headers=finance_headers,
    )
    assert set_rate.status_code == 200

    fixture = _create_demand_fixture(db, "test-tenant-001", period["id"], 2027, 7, "detail", fte_percent=50)

    res = client.get(
        f"/finance/consolidated-costs/detail?year=2027&month=7&project_id={fixture['project_id']}",
        headers=finance_headers,
    )
    assert res.status_code == 200
    details = res.json()
    assert len(details) == 1
    assert details[0]["demand_lines"][0]["cost"] == 60000


def test_multi_period_consolidated_costs_use_each_period_rate(client, db, finance_headers):
    p1 = client.post("/periods", json={"year": 2027, "month": 8}, headers=finance_headers).json()
    p2 = client.post("/periods", json={"year": 2027, "month": 9}, headers=finance_headers).json()

    assert client.put(
        f"/finance/settings/monthly_fte_cost?period_id={p1['id']}",
        json={"setting_value": "100000"},
        headers=finance_headers,
    ).status_code == 200
    assert client.put(
        f"/finance/settings/monthly_fte_cost?period_id={p2['id']}",
        json={"setting_value": "140000"},
        headers=finance_headers,
    ).status_code == 200

    fixture1 = _create_demand_fixture(db, "test-tenant-001", p1["id"], 2027, 8, "multi1", fte_percent=50)
    fixture2 = _create_demand_fixture(db, "test-tenant-001", p2["id"], 2027, 9, "multi2", fte_percent=50)

    # Use explicit year/month queries to ensure locked/open state does not affect this test.
    res1 = client.get("/finance/consolidated-costs?year=2027&month=8", headers=finance_headers)
    res2 = client.get("/finance/consolidated-costs?year=2027&month=9", headers=finance_headers)
    assert res1.status_code == 200
    assert res2.status_code == 200

    row1 = [r for r in res1.json()["data"] if r["project_id"] == fixture1["project_id"]][0]
    row2 = [r for r in res2.json()["data"] if r["project_id"] == fixture2["project_id"]][0]
    assert row1["demand_cost"] == 50000
    assert row2["demand_cost"] == 70000


def test_locked_period_cost_stays_after_other_period_rate_change(client, db, finance_headers):
    april = client.post("/periods", json={"year": 2027, "month": 4}, headers=finance_headers).json()
    june = client.post("/periods", json={"year": 2027, "month": 6}, headers=finance_headers).json()

    assert client.put(
        f"/finance/settings/monthly_fte_cost?period_id={april['id']}",
        json={"setting_value": "100000"},
        headers=finance_headers,
    ).status_code == 200
    assert client.put(
        f"/finance/settings/monthly_fte_cost?period_id={june['id']}",
        json={"setting_value": "120000"},
        headers=finance_headers,
    ).status_code == 200

    fixture_april = _create_demand_fixture(db, "test-tenant-001", april["id"], 2027, 4, "archive", fte_percent=50)
    _create_demand_fixture(db, "test-tenant-001", june["id"], 2027, 6, "current", fte_percent=50)

    lock = client.post(f"/periods/{april['id']}/lock", headers=finance_headers)
    assert lock.status_code == 200

    before = client.get("/finance/consolidated-costs?year=2027&month=4", headers=finance_headers)
    assert before.status_code == 200
    before_row = [r for r in before.json()["data"] if r["project_id"] == fixture_april["project_id"]][0]
    assert before_row["demand_cost"] == 50000

    # Change June only
    change = client.put(
        f"/finance/settings/monthly_fte_cost?period_id={june['id']}",
        json={"setting_value": "150000"},
        headers=finance_headers,
    )
    assert change.status_code == 200

    after = client.get("/finance/consolidated-costs?year=2027&month=4", headers=finance_headers)
    assert after.status_code == 200
    after_row = [r for r in after.json()["data"] if r["project_id"] == fixture_april["project_id"]][0]
    assert after_row["demand_cost"] == 50000


# ─── Manager+PM scope tests for /finance/consolidated-costs ───────────────────


def _setup_finance_manager_pm_fixture(db, tenant_id: str):
    """
    Topology for Finance Manager+PM scope tests:

      manager_pm_user  (role=Manager, secondary_role=PM)
        ↳ ro_user_id of cc-fin-managed

      cc-fin-managed  — managed by manager_pm_user
      cc-fin-other    — not managed by manager_pm_user

      res-fin-a  in cc-fin-managed
      res-fin-b  in cc-fin-other

      proj-fin-alpha  — assigned to manager_pm_user as PM; demand for both resources
      proj-fin-other  — NOT assigned to manager_pm_user; demand for res-fin-b

    Plain Manager (scope=default): sees only res-fin-a costs (managed CC only).
    Manager+PM (scope=pm): sees all costs for proj-fin-alpha (both CCs), NOT proj-fin-other.
    Manager+PM (scope=default): union — managed-CC costs PLUS all costs of assigned PM
    projects (proj-fin-alpha across both CCs), but NOT proj-fin-other's unmanaged demand.
    """
    from api.app.models.core import User, CostCenter, Resource, Project, ProjectPM, Period, UserRole
    from api.app.models.planning import DemandLine

    manager_pm_user = User(
        tenant_id=tenant_id,
        object_id="fin-mpm-obj-001",
        email="fin-mpm@test.com",
        display_name="Finance MPM User",
        role=UserRole.MANAGER,
        secondary_role=UserRole.PM.value,
        is_active=True,
    )
    db.add(manager_pm_user)
    db.flush()

    cc_managed = CostCenter(id="cc-fin-managed", tenant_id=tenant_id, name="Managed CC Fin", code="MCF", ro_user_id=manager_pm_user.id)
    cc_other = CostCenter(id="cc-fin-other", tenant_id=tenant_id, name="Other CC Fin", code="OCF")
    db.add(cc_managed)
    db.add(cc_other)

    res_a = Resource(id="res-fin-a", tenant_id=tenant_id, display_name="Res A Fin", cost_center_id="cc-fin-managed", employee_id="FIN-A")
    res_b = Resource(id="res-fin-b", tenant_id=tenant_id, display_name="Res B Fin", cost_center_id="cc-fin-other", employee_id="FIN-B")
    db.add(res_a)
    db.add(res_b)

    proj_alpha = Project(id="proj-fin-alpha", tenant_id=tenant_id, name="Alpha Fin", code="ALFA")
    proj_other = Project(id="proj-fin-other", tenant_id=tenant_id, name="Other Fin", code="OTHF")
    db.add(proj_alpha)
    db.add(proj_other)

    # Assign manager_pm_user as PM on proj_alpha only
    db.add(ProjectPM(project_id="proj-fin-alpha", user_id=manager_pm_user.id, tenant_id=tenant_id))

    period = Period(id="period-fin-mpm-1", tenant_id=tenant_id, year=2026, month=9, status="open")
    db.add(period)

    # proj_alpha: demand for both resources (spans both CCs)
    db.add(DemandLine(id="dl-fin-a", tenant_id=tenant_id, period_id="period-fin-mpm-1", project_id="proj-fin-alpha", resource_id="res-fin-a", year=2026, month=9, fte_percent=50, created_by="fin-mpm-obj-001"))
    db.add(DemandLine(id="dl-fin-b", tenant_id=tenant_id, period_id="period-fin-mpm-1", project_id="proj-fin-alpha", resource_id="res-fin-b", year=2026, month=9, fte_percent=50, created_by="fin-mpm-obj-001"))
    # proj_other: demand for res_b only (Manager+PM not assigned as PM here)
    db.add(DemandLine(id="dl-fin-c", tenant_id=tenant_id, period_id="period-fin-mpm-1", project_id="proj-fin-other", resource_id="res-fin-b", year=2026, month=9, fte_percent=30, created_by="fin-mpm-obj-001"))
    db.commit()

    return manager_pm_user


def test_finance_plain_manager_default_scope_sees_managed_cc_only(client, db):
    """Plain Manager sees only costs from resources in their managed CC."""
    from api.app.models.core import User, CostCenter, Resource, Project, Period, UserRole
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant-001"

    plain_mgr = User(tenant_id=tenant_id, object_id="fin-plain-obj-001", email="fin-plain@test.com", display_name="Fin Plain Mgr", role=UserRole.MANAGER, is_active=True)
    db.add(plain_mgr)
    db.flush()

    cc_mine = CostCenter(id="cc-fp-mine", tenant_id=tenant_id, name="FP Mine CC", code="FPM", ro_user_id=plain_mgr.id)
    cc_theirs = CostCenter(id="cc-fp-other", tenant_id=tenant_id, name="FP Other CC", code="FPO")
    db.add(cc_mine)
    db.add(cc_theirs)
    db.add(Resource(id="res-fp-a", tenant_id=tenant_id, display_name="FP Alice", cost_center_id="cc-fp-mine", employee_id="FP-A"))
    db.add(Resource(id="res-fp-b", tenant_id=tenant_id, display_name="FP Bob", cost_center_id="cc-fp-other", employee_id="FP-B"))
    db.add(Project(id="proj-fp-1", tenant_id=tenant_id, name="FP Proj", code="FPP"))
    db.add(Period(id="period-fp-1", tenant_id=tenant_id, year=2026, month=10, status="open"))
    db.add(DemandLine(id="dl-fp-a", tenant_id=tenant_id, period_id="period-fp-1", project_id="proj-fp-1", resource_id="res-fp-a", year=2026, month=10, fte_percent=50, created_by="fin-plain-obj-001"))
    db.add(DemandLine(id="dl-fp-b", tenant_id=tenant_id, period_id="period-fp-1", project_id="proj-fp-1", resource_id="res-fp-b", year=2026, month=10, fte_percent=50, created_by="fin-plain-obj-001"))
    db.commit()

    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "fin-plain-obj-001"}
    res = client.get("/finance/consolidated-costs?year=2026&month=10", headers=headers)
    assert res.status_code == 200
    rows = res.json()["data"]
    project_ids = {r["project_id"] for r in rows}
    # res-fp-b is outside managed CC — its demand row must not appear
    cc_ids = {r.get("cost_center_id") for r in rows if r["project_id"] == "proj-fp-1"}
    assert "cc-fp-mine" in cc_ids or "proj-fp-1" in project_ids  # res-fp-a demand visible
    assert "cc-fp-other" not in cc_ids, "Plain Manager must not see costs from unmanaged CCs"


def test_finance_plain_manager_scope_pm_still_sees_managed_cc_only(client, db):
    """Plain Manager + scope=pm must NOT bypass Manager resource filtering."""
    from api.app.models.core import User, CostCenter, Resource, Project, Period, UserRole
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant-001"

    plain_mgr2 = User(tenant_id=tenant_id, object_id="fin-plain-obj-002", email="fin-plain2@test.com", display_name="Fin Plain Mgr2", role=UserRole.MANAGER, is_active=True)
    db.add(plain_mgr2)
    db.flush()

    cc_mine = CostCenter(id="cc-fp2-mine", tenant_id=tenant_id, name="FP2 Mine CC", code="FP2M", ro_user_id=plain_mgr2.id)
    cc_theirs = CostCenter(id="cc-fp2-other", tenant_id=tenant_id, name="FP2 Other CC", code="FP2O")
    db.add(cc_mine)
    db.add(cc_theirs)
    db.add(Resource(id="res-fp2-a", tenant_id=tenant_id, display_name="FP2 Alice", cost_center_id="cc-fp2-mine", employee_id="FP2-A"))
    db.add(Resource(id="res-fp2-b", tenant_id=tenant_id, display_name="FP2 Bob", cost_center_id="cc-fp2-other", employee_id="FP2-B"))
    db.add(Project(id="proj-fp2-1", tenant_id=tenant_id, name="FP2 Proj", code="FP2P"))
    db.add(Period(id="period-fp2-1", tenant_id=tenant_id, year=2026, month=11, status="open"))
    db.add(DemandLine(id="dl-fp2-a", tenant_id=tenant_id, period_id="period-fp2-1", project_id="proj-fp2-1", resource_id="res-fp2-a", year=2026, month=11, fte_percent=50, created_by="fin-plain-obj-002"))
    db.add(DemandLine(id="dl-fp2-b", tenant_id=tenant_id, period_id="period-fp2-1", project_id="proj-fp2-1", resource_id="res-fp2-b", year=2026, month=11, fte_percent=50, created_by="fin-plain-obj-002"))
    db.commit()

    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "fin-plain-obj-002"}
    res = client.get("/finance/consolidated-costs?year=2026&month=11&scope=pm", headers=headers)
    assert res.status_code == 200
    rows = res.json()["data"]
    cc_ids = {r.get("cost_center_id") for r in rows if r["project_id"] == "proj-fp2-1"}
    assert "cc-fp2-other" not in cc_ids, "Plain Manager + scope=pm must not bypass Manager resource filtering"


def test_finance_manager_pm_default_scope_is_union_of_manager_and_pm(client, db):
    """Manager+PM default scope sees managed-CC costs plus assigned-PM-project costs."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "fin-mpm-obj-001",
    }
    res = client.get("/finance/consolidated-costs?year=2026&month=9", headers=headers)
    assert res.status_code == 200
    rows = res.json()["data"]
    # Manager side: managed-CC demand visible
    alpha_cc_ids = {r.get("cost_center_id") for r in rows if r["project_id"] == "proj-fin-alpha"}
    assert "cc-fin-managed" in alpha_cc_ids, "Union scope must include managed-CC demand"
    # PM side: assigned PM project demand visible even from unmanaged CC
    assert "cc-fin-other" in alpha_cc_ids, "Union scope must include PM-project demand from other CCs"
    # Not broadened: unassigned project's unmanaged-CC demand stays hidden
    project_ids = {r["project_id"] for r in rows}
    assert "proj-fin-other" not in project_ids, (
        "Union scope must not expose non-PM projects outside the Manager resource scope"
    )


def test_finance_manager_pm_scope_pm_sees_pm_project_costs(client, db):
    """Manager+PM scope=pm (PM tab) sees costs for PM-assigned projects across all CCs."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "fin-mpm-obj-001",
    }
    res = client.get("/finance/consolidated-costs?year=2026&month=9&scope=pm", headers=headers)
    assert res.status_code == 200
    rows = res.json()["data"]
    # proj-fin-alpha is assigned to this Manager+PM — both CC rows must appear
    alpha_rows = [r for r in rows if r["project_id"] == "proj-fin-alpha"]
    alpha_cc_ids = {r.get("cost_center_id") for r in alpha_rows}
    assert "cc-fin-managed" in alpha_cc_ids, "PM tab must show managed-CC demand for PM project"
    assert "cc-fin-other" in alpha_cc_ids, "PM tab must show other-CC demand for PM project"
    # proj-fin-other is NOT a PM project — must not appear
    other_project_ids = {r["project_id"] for r in rows}
    assert "proj-fin-other" not in other_project_ids, "PM tab must not show projects where user is not PM"


def test_finance_manager_pm_scope_pm_detail_project_mode(client, db):
    """Manager+PM scope=pm can fetch project-mode detail for their PM project."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "fin-mpm-obj-001",
    }
    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&project_id=proj-fin-alpha&scope=pm",
        headers=headers,
    )
    assert res.status_code == 200
    details = res.json()
    assert len(details) == 1
    demand_resource_names = {d["resource_name"] for d in details[0]["demand_lines"]}
    # Both resources' demand lines must appear (not filtered to managed CC only)
    assert "Res A Fin" in demand_resource_names, "PM project detail must include managed-CC resource"
    assert "Res B Fin" in demand_resource_names, "PM project detail must include other-CC resource for PM project"


def test_finance_manager_pm_default_scope_detail_pm_project_full(client, db):
    """Manager+PM default-scope detail for an assigned PM project shows all its lines (union)."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "fin-mpm-obj-001",
    }
    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&project_id=proj-fin-alpha",
        headers=headers,
    )
    assert res.status_code == 200
    details = res.json()
    assert len(details) == 1
    demand_resource_names = {d["resource_name"] for d in details[0]["demand_lines"]}
    assert "Res A Fin" in demand_resource_names, "Union detail must include managed-CC resource"
    assert "Res B Fin" in demand_resource_names, "Union detail must include other-CC resource for PM project"


def test_finance_manager_pm_default_scope_detail_non_pm_project_restricted(client, db):
    """Manager+PM default-scope detail for a NON-PM project stays Manager-resource scoped."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "fin-mpm-obj-001",
    }
    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&project_id=proj-fin-other",
        headers=headers,
    )
    assert res.status_code == 200
    details = res.json()
    assert len(details) == 1
    demand_resource_names = {d["resource_name"] for d in details[0]["demand_lines"]}
    # proj-fin-other's only demand is res-fin-b in an unmanaged CC — must stay hidden
    assert "Res B Fin" not in demand_resource_names, (
        "Non-PM project detail must not expose unmanaged-CC resources"
    )


def test_finance_manager_pm_default_scope_includes_delegated_cc(client, db):
    """Manager+PM default scope includes resources from actively delegated cost centers."""
    from api.app.models.core import User, CostCenter, Resource, Project, Period, UserRole, ApprovalDelegate
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant-001"
    mpm_user = _setup_finance_manager_pm_fixture(db, tenant_id)

    # A delegator manager owning a third CC with demand on a non-PM project
    delegator = User(
        tenant_id=tenant_id, object_id="fin-deleg-obj-001", email="fin-deleg@test.com",
        display_name="Fin Delegator", role=UserRole.MANAGER, is_active=True,
    )
    db.add(delegator)
    db.flush()
    db.add(CostCenter(id="cc-fin-deleg", tenant_id=tenant_id, name="Delegated CC Fin", code="DCF", ro_user_id=delegator.id))
    db.add(Resource(id="res-fin-d", tenant_id=tenant_id, display_name="Res D Fin", cost_center_id="cc-fin-deleg", employee_id="FIN-D"))
    db.add(Project(id="proj-fin-deleg", tenant_id=tenant_id, name="Deleg Fin", code="DLGF"))
    db.add(DemandLine(
        id="dl-fin-d", tenant_id=tenant_id, period_id="period-fin-mpm-1",
        project_id="proj-fin-deleg", resource_id="res-fin-d",
        year=2026, month=9, fte_percent=40, created_by="fin-deleg-obj-001",
    ))
    db.add(ApprovalDelegate(
        tenant_id=tenant_id, delegator_id=delegator.id, delegate_id=mpm_user.id,
        is_active=True, created_by="fin-deleg-obj-001",
    ))
    db.commit()

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "fin-mpm-obj-001",
    }
    res = client.get("/finance/consolidated-costs?year=2026&month=9", headers=headers)
    assert res.status_code == 200
    rows = res.json()["data"]
    deleg_cc_ids = {r.get("cost_center_id") for r in rows if r["project_id"] == "proj-fin-deleg"}
    assert "cc-fin-deleg" in deleg_cc_ids, "Union scope must include delegated-CC demand"


# ─── OoP/Equipment visibility in consolidated costs ───────────────────────────


def _add_finance_ext_equip(db, tenant_id: str):
    """Layer OoP/Equipment lines onto _setup_finance_manager_pm_fixture.

    ext-fin-other deliberately sits on a managed-CC resource (res-fin-a) but a
    non-PM project — the case where Manager resource scope must NOT grant access.
    """
    from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine

    db.add(ProjectExternalLine(id="ext-fin-alpha", tenant_id=tenant_id, project_id="proj-fin-alpha", period_id="period-fin-mpm-1", resource_id="res-fin-a", description="Alpha vendor", cost=10000, created_by="t"))
    db.add(ProjectExternalLine(id="ext-fin-other", tenant_id=tenant_id, project_id="proj-fin-other", period_id="period-fin-mpm-1", resource_id="res-fin-a", description="Other vendor", cost=20000, created_by="t"))
    db.add(ProjectEquipmentLine(id="eq-fin-alpha", tenant_id=tenant_id, project_id="proj-fin-alpha", period_id="period-fin-mpm-1", description="Alpha rig", cost=30000, created_by="t"))
    db.add(ProjectEquipmentLine(id="eq-fin-other", tenant_id=tenant_id, project_id="proj-fin-other", period_id="period-fin-mpm-1", description="Other rig", cost=40000, created_by="t"))
    db.commit()


def _ext_equip_by_project(rows):
    ext: dict = {}
    equip: dict = {}
    for r in rows:
        ext[r["project_id"]] = ext.get(r["project_id"], 0) + r["externals_cost"]
        equip[r["project_id"]] = equip.get(r["project_id"], 0) + r["equipment_cost"]
    return ext, equip


_MPM_HEADERS = {
    "X-Dev-Role": "Manager",
    "X-Dev-Secondary-Role": "PM",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "fin-mpm-obj-001",
}
# Same DB user demoted to plain Manager (secondary role cleared via dev header)
_PLAIN_MGR_HEADERS = {
    "X-Dev-Role": "Manager",
    "X-Dev-Secondary-Role": "",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "fin-mpm-obj-001",
}
# Same DB user as pure PM
_PURE_PM_HEADERS = {
    "X-Dev-Role": "PM",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "fin-mpm-obj-001",
}
_FINANCE_HEADERS = {
    "X-Dev-Role": "Finance",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "fin-viewer-obj-001",
}


def test_oop_equip_manager_pm_limited_to_pm_projects(client, db):
    """Manager+PM sees OoP/Equipment only for PM-assigned projects, not via Manager CC scope."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get("/finance/consolidated-costs?year=2026&month=9", headers=_MPM_HEADERS)
    assert res.status_code == 200
    ext, equip = _ext_equip_by_project(res.json()["data"])
    assert ext.get("proj-fin-alpha", 0) == 10000, "PM project OoP must be visible"
    assert equip.get("proj-fin-alpha", 0) == 30000, "PM project equipment must be visible"
    assert ext.get("proj-fin-other", 0) == 0, "Non-PM project OoP must be hidden despite managed-CC resource"
    assert equip.get("proj-fin-other", 0) == 0, "Non-PM project equipment must be hidden"


def test_oop_equip_plain_manager_sees_none(client, db):
    """Plain Manager sees no OoP/Equipment in cost overview, but keeps labor data."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get("/finance/consolidated-costs?year=2026&month=9", headers=_PLAIN_MGR_HEADERS)
    assert res.status_code == 200
    rows = res.json()["data"]
    assert sum(r["externals_cost"] for r in rows) == 0, "Plain Manager must not see any OoP cost"
    assert sum(r["equipment_cost"] for r in rows) == 0, "Plain Manager must not see any equipment cost"
    assert sum(r["demand_cost"] for r in rows) > 0, "Plain Manager must still see managed-CC labor data"


def test_oop_equip_pure_pm_limited_to_assigned_projects(client, db):
    """Pure PM sees OoP/Equipment for assigned projects only."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get("/finance/consolidated-costs?year=2026&month=9", headers=_PURE_PM_HEADERS)
    assert res.status_code == 200
    ext, equip = _ext_equip_by_project(res.json()["data"])
    assert ext.get("proj-fin-alpha", 0) == 10000
    assert equip.get("proj-fin-alpha", 0) == 30000
    assert "proj-fin-other" not in ext or ext["proj-fin-other"] == 0
    assert "proj-fin-other" not in equip or equip["proj-fin-other"] == 0


def test_oop_equip_finance_sees_all(client, db):
    """Finance keeps full OoP/Equipment visibility."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get("/finance/consolidated-costs?year=2026&month=9", headers=_FINANCE_HEADERS)
    assert res.status_code == 200
    ext, equip = _ext_equip_by_project(res.json()["data"])
    assert ext.get("proj-fin-alpha", 0) == 10000
    assert ext.get("proj-fin-other", 0) == 20000
    assert equip.get("proj-fin-alpha", 0) == 30000
    assert equip.get("proj-fin-other", 0) == 40000


def test_oop_equip_detail_manager_pm_pm_project_visible(client, db):
    """Manager+PM project drilldown for an assigned PM project includes OoP/Equipment lines."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&project_id=proj-fin-alpha",
        headers=_MPM_HEADERS,
    )
    assert res.status_code == 200
    d = res.json()[0]
    assert len(d["external_lines"]) == 1
    assert len(d["equipment_lines"]) == 1


def test_oop_equip_detail_manager_pm_non_pm_project_hidden(client, db):
    """Manager+PM project drilldown for a non-PM project hides OoP/Equipment lines."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&project_id=proj-fin-other",
        headers=_MPM_HEADERS,
    )
    assert res.status_code == 200
    d = res.json()[0]
    assert d["external_lines"] == [], "Non-PM project OoP lines must be hidden from Manager+PM"
    assert d["equipment_lines"] == [], "Non-PM project equipment lines must be hidden from Manager+PM"


def test_oop_equip_detail_plain_manager_hidden(client, db):
    """Plain Manager project drilldown never includes OoP/Equipment lines."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&project_id=proj-fin-alpha",
        headers=_PLAIN_MGR_HEADERS,
    )
    assert res.status_code == 200
    d = res.json()[0]
    assert d["external_lines"] == []
    assert d["equipment_lines"] == []


def test_oop_equip_detail_cc_mode_scoping(client, db):
    """CC drilldown: Manager+PM sees only PM-project OoP lines; plain Manager sees none."""
    tenant_id = "test-tenant-001"
    _setup_finance_manager_pm_fixture(db, tenant_id)
    _add_finance_ext_equip(db, tenant_id)

    res = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&cost_center_id=cc-fin-managed",
        headers=_MPM_HEADERS,
    )
    assert res.status_code == 200
    d = res.json()[0]
    descriptions = {l["description"] for l in d["external_lines"]}
    assert "Alpha vendor" in descriptions, "PM-project OoP line in managed CC must be visible"
    assert "Other vendor" not in descriptions, "Non-PM project OoP line must be hidden despite managed CC"

    res2 = client.get(
        "/finance/consolidated-costs/detail?year=2026&month=9&cost_center_id=cc-fin-managed",
        headers=_PLAIN_MGR_HEADERS,
    )
    assert res2.status_code == 200
    assert res2.json()[0]["external_lines"] == [], "Plain Manager must see no OoP lines in CC drilldown"
