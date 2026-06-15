"""Tests: /demand-lines/all and /supply-lines/all `open_periods_only` param.

Default (True) keeps the existing behavior: locked periods are excluded.
open_periods_only=false includes locked-period lines for the read-only
historical view. Writes to locked periods stay rejected (covered elsewhere).
"""
import pytest

TENANT = "test-tenant-001"   # matches finance_headers in conftest.py


@pytest.fixture
def history_data(db):
    """One open + one locked period, each with a demand and a supply line."""
    from datetime import datetime
    from api.app.models.core import Period, Project, CostCenter, Resource
    from api.app.models.planning import DemandLine, SupplyLine

    db.add(Period(id="p-open", tenant_id=TENANT, year=2026, month=6, status="open"))
    db.add(Period(id="p-locked", tenant_id=TENANT, year=2026, month=5, status="locked"))
    db.add(Project(id="proj-h", tenant_id=TENANT, name="HistProject", code="HST"))
    db.add(CostCenter(id="cc-h", tenant_id=TENANT, name="Hist CC", code="CCH"))
    db.commit()
    db.add(Resource(
        id="res-h", tenant_id=TENANT, display_name="Hist Resource",
        email="hist@test.com", cost_center_id="cc-h", employee_id="EMPH01",
    ))
    db.commit()

    now = datetime.utcnow()
    for period_id, year, month in (("p-open", 2026, 6), ("p-locked", 2026, 5)):
        db.add(DemandLine(
            id=f"dl-{period_id}", tenant_id=TENANT, period_id=period_id,
            project_id="proj-h", resource_id="res-h",
            year=year, month=month, fte_percent=50,
            created_by="test", created_at=now, updated_at=now,
        ))
        db.add(SupplyLine(
            id=f"sl-{period_id}", tenant_id=TENANT, period_id=period_id,
            resource_id="res-h", project_id="proj-h",
            year=year, month=month, fte_percent=50,
            created_by="test", created_at=now, updated_at=now,
        ))
    db.commit()


def _period_ids(resp):
    assert resp.status_code == 200, resp.text
    return {line["period_id"] for line in resp.json()}


def test_demand_all_default_excludes_locked(client, history_data, finance_headers):
    ids = _period_ids(client.get("/demand-lines/all", headers=finance_headers))
    assert "p-open" in ids
    assert "p-locked" not in ids


def test_demand_all_include_locked(client, history_data, finance_headers):
    ids = _period_ids(client.get(
        "/demand-lines/all", params={"open_periods_only": "false"}, headers=finance_headers
    ))
    assert {"p-open", "p-locked"} <= ids


def test_supply_all_default_excludes_locked(client, history_data, finance_headers):
    ids = _period_ids(client.get("/supply-lines/all", headers=finance_headers))
    assert "p-open" in ids
    assert "p-locked" not in ids


def test_supply_all_include_locked(client, history_data, finance_headers):
    ids = _period_ids(client.get(
        "/supply-lines/all", params={"open_periods_only": "false"}, headers=finance_headers
    ))
    assert {"p-open", "p-locked"} <= ids
