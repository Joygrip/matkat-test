"""Tests: OoP (externals) and Equipment writes are rejected for locked periods.

The period-lock guard exists for demand/supply/actuals; these tests cover the
project-costs endpoints, which previously had no lock enforcement at all.
Reads of locked-period data must keep working (historical viewing).
"""
import pytest

TENANT = "test-tenant-001"   # matches finance_headers in conftest.py


# ─── Test-local DB helpers ─────────────────────────────────────────────────

def _make_period(db, period_id, year=2026, month=5, status="locked"):
    from api.app.models.core import Period
    p = Period(id=period_id, tenant_id=TENANT, year=year, month=month, status=status)
    db.add(p)
    db.commit()
    return p


def _make_project(db, project_id="proj-lock-01", name="LockProject", code="LCK"):
    from api.app.models.core import Project
    proj = Project(id=project_id, tenant_id=TENANT, name=name, code=code)
    db.add(proj)
    db.commit()
    return proj


def _make_external_line(db, period_id, line_id="ext-lock-01"):
    from datetime import datetime
    from api.app.models.project_costs import ProjectExternalLine
    line = ProjectExternalLine(
        id=line_id,
        tenant_id=TENANT,
        project_id="proj-lock-01",
        period_id=period_id,
        description="Pre-existing OoP",
        cost=10000,
        created_by="test",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(line)
    db.commit()
    return line


def _make_equipment_line(db, period_id, line_id="equip-lock-01"):
    from datetime import datetime
    from api.app.models.project_costs import ProjectEquipmentLine
    line = ProjectEquipmentLine(
        id=line_id,
        tenant_id=TENANT,
        project_id="proj-lock-01",
        period_id=period_id,
        description="Pre-existing equipment",
        cost=5000,
        created_by="test",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(line)
    db.commit()
    return line


def _assert_period_locked(resp):
    """The app's HTTPException handler emits Problem Details: code is top-level."""
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "PERIOD_LOCKED", resp.text


# ─── Externals (OoP) ────────────────────────────────────────────────────────

def test_create_external_in_locked_period_rejected(client, db, finance_headers):
    _make_period(db, "p-locked-01")
    _make_project(db)
    resp = client.post(
        "/project-costs/externals",
        json={"project_id": "proj-lock-01", "period_id": "p-locked-01", "description": "Late invoice", "cost": 1000},
        headers=finance_headers,
    )
    _assert_period_locked(resp)


def test_update_external_in_locked_period_rejected(client, db, finance_headers):
    _make_period(db, "p-locked-01")
    _make_project(db)
    _make_external_line(db, "p-locked-01")
    resp = client.put(
        "/project-costs/externals/ext-lock-01",
        json={"cost": 2000},
        headers=finance_headers,
    )
    _assert_period_locked(resp)


def test_delete_external_in_locked_period_rejected(client, db, finance_headers):
    _make_period(db, "p-locked-01")
    _make_project(db)
    _make_external_line(db, "p-locked-01")
    resp = client.delete("/project-costs/externals/ext-lock-01", headers=finance_headers)
    _assert_period_locked(resp)


# ─── Equipment ──────────────────────────────────────────────────────────────

def test_create_equipment_in_locked_period_rejected(client, db, finance_headers):
    _make_period(db, "p-locked-01")
    _make_project(db)
    resp = client.post(
        "/project-costs/equipment",
        json={"project_id": "proj-lock-01", "period_id": "p-locked-01", "description": "Late purchase", "cost": 1000},
        headers=finance_headers,
    )
    _assert_period_locked(resp)


def test_update_equipment_in_locked_period_rejected(client, db, finance_headers):
    _make_period(db, "p-locked-01")
    _make_project(db)
    _make_equipment_line(db, "p-locked-01")
    resp = client.put(
        "/project-costs/equipment/equip-lock-01",
        json={"cost": 2000},
        headers=finance_headers,
    )
    _assert_period_locked(resp)


def test_delete_equipment_in_locked_period_rejected(client, db, finance_headers):
    _make_period(db, "p-locked-01")
    _make_project(db)
    _make_equipment_line(db, "p-locked-01")
    resp = client.delete("/project-costs/equipment/equip-lock-01", headers=finance_headers)
    _assert_period_locked(resp)


# ─── Open periods unaffected / locked reads still work ─────────────────────

def test_create_external_in_open_period_still_works(client, db, finance_headers):
    _make_period(db, "p-open-01", month=6, status="open")
    _make_project(db)
    resp = client.post(
        "/project-costs/externals",
        json={"project_id": "proj-lock-01", "period_id": "p-open-01", "description": "Vendor", "cost": 1000},
        headers=finance_headers,
    )
    assert resp.status_code == 201, resp.text


def test_locked_period_lines_remain_readable(client, db, finance_headers):
    """Historical viewing: list endpoints must keep returning locked-period data."""
    _make_period(db, "p-locked-01")
    _make_project(db)
    _make_external_line(db, "p-locked-01")
    _make_equipment_line(db, "p-locked-01")

    ext = client.get(
        "/project-costs/externals", params={"period_id": "p-locked-01"}, headers=finance_headers
    )
    assert ext.status_code == 200, ext.text
    assert len(ext.json()) == 1

    equip = client.get(
        "/project-costs/equipment", params={"period_id": "p-locked-01"}, headers=finance_headers
    )
    assert equip.status_code == 200, equip.text
    assert len(equip.json()) == 1
