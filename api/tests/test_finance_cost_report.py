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
