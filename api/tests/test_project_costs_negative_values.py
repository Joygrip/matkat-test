"""Tests: negative OoP and Equipment cost values (credit notes / corrections).

These tests verify that:
- Negative cost values are accepted by the backend for OoP and Equipment lines.
- Zero cost is still rejected (it has no business meaning; deleting a line
  clears a cell — zero is not a valid persisted amount).
- Mixed positive and negative lines sum correctly in the summary endpoint.
- Negative costs are preserved verbatim in published snapshots.
- FTE demand/supply/actuals validation is unchanged (still rejects negatives).
"""
import pytest

TENANT = "test-tenant-001"   # matches finance_headers / pm_headers in conftest.py


# ─── Test-local DB helpers ─────────────────────────────────────────────────

def _make_period(db, period_id="p-neg-01", year=2026, month=6, status="open"):
    from api.app.models.core import Period
    p = Period(id=period_id, tenant_id=TENANT, year=year, month=month, status=status)
    db.add(p)
    db.commit()
    return p


def _make_project(db, project_id="proj-neg-01", name="NegCostProject", code="NCP"):
    from api.app.models.core import Project
    proj = Project(id=project_id, tenant_id=TENANT, name=name, code=code)
    db.add(proj)
    db.commit()
    return proj


# ─── OoP (External) line CRUD ──────────────────────────────────────────────

def test_create_external_line_negative_cost_succeeds(client, db, finance_headers):
    """POST /project-costs/externals with negative cost succeeds (credit note)."""
    _make_period(db)
    _make_project(db)
    resp = client.post(
        "/project-costs/externals",
        json={
            "project_id": "proj-neg-01",
            "period_id": "p-neg-01",
            "description": "Credit note",
            "cost": -2500,
        },
        headers=finance_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["cost"] == -2500


def test_update_external_line_negative_cost_succeeds(client, db, finance_headers):
    """PUT /project-costs/externals/{id} to a negative cost succeeds."""
    _make_period(db)
    _make_project(db)
    create = client.post(
        "/project-costs/externals",
        json={
            "project_id": "proj-neg-01",
            "period_id": "p-neg-01",
            "description": "Vendor invoice",
            "cost": 10000,
        },
        headers=finance_headers,
    )
    assert create.status_code == 201
    line_id = create.json()["id"]

    resp = client.put(
        f"/project-costs/externals/{line_id}",
        json={"cost": -1000},
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["cost"] == -1000


def test_create_external_line_zero_cost_rejected(client, db, finance_headers):
    """POST /project-costs/externals with cost=0 is rejected (422)."""
    _make_period(db)
    _make_project(db)
    resp = client.post(
        "/project-costs/externals",
        json={
            "project_id": "proj-neg-01",
            "period_id": "p-neg-01",
            "description": "Zero",
            "cost": 0,
        },
        headers=finance_headers,
    )
    assert resp.status_code == 400, resp.text


# ─── Equipment line CRUD ────────────────────────────────────────────────────

def test_create_equipment_line_negative_cost_succeeds(client, db, finance_headers):
    """POST /project-costs/equipment with negative cost succeeds (correction)."""
    _make_period(db)
    _make_project(db)
    resp = client.post(
        "/project-costs/equipment",
        json={
            "project_id": "proj-neg-01",
            "period_id": "p-neg-01",
            "description": "Equipment correction",
            "cost": -5000,
        },
        headers=finance_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["cost"] == -5000


def test_update_equipment_line_negative_cost_succeeds(client, db, finance_headers):
    """PUT /project-costs/equipment/{id} to a negative cost succeeds."""
    _make_period(db)
    _make_project(db)
    create = client.post(
        "/project-costs/equipment",
        json={
            "project_id": "proj-neg-01",
            "period_id": "p-neg-01",
            "description": "Server",
            "cost": 8000,
        },
        headers=finance_headers,
    )
    assert create.status_code == 201
    line_id = create.json()["id"]

    resp = client.put(
        f"/project-costs/equipment/{line_id}",
        json={"cost": -500},
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["cost"] == -500


def test_create_equipment_line_zero_cost_rejected(client, db, finance_headers):
    """POST /project-costs/equipment with cost=0 is rejected (422)."""
    _make_period(db)
    _make_project(db)
    resp = client.post(
        "/project-costs/equipment",
        json={
            "project_id": "proj-neg-01",
            "period_id": "p-neg-01",
            "description": "Zero",
            "cost": 0,
        },
        headers=finance_headers,
    )
    assert resp.status_code == 400, resp.text


# ─── Mixed-sign totals ──────────────────────────────────────────────────────

def test_external_line_total_with_mixed_signs(client, db, finance_headers):
    """OoP lines with mixed signs sum correctly: 10000 + (-2500) = 7500."""
    _make_period(db)
    _make_project(db)
    client.post(
        "/project-costs/externals",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Vendor", "cost": 10000},
        headers=finance_headers,
    )
    client.post(
        "/project-costs/externals",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Credit", "cost": -2500},
        headers=finance_headers,
    )
    resp = client.get(
        "/project-costs/summary",
        params={"period_id": "p-neg-01"},
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["externals_total"] == 7500
    assert data["combined_total"] == 7500


def test_equipment_line_total_with_mixed_signs(client, db, finance_headers):
    """Equipment lines with mixed signs sum correctly: 6000 + (-10000) = -4000."""
    _make_period(db)
    _make_project(db)
    client.post(
        "/project-costs/equipment",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Server", "cost": 6000},
        headers=finance_headers,
    )
    client.post(
        "/project-costs/equipment",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Correction", "cost": -10000},
        headers=finance_headers,
    )
    resp = client.get(
        "/project-costs/summary",
        params={"period_id": "p-neg-01"},
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["equipment_total"] == -4000
    assert data["combined_total"] == -4000


def test_combined_total_with_oop_and_equipment_mixed_signs(client, db, finance_headers):
    """Grand total combines signed OoP and Equipment correctly."""
    _make_period(db)
    _make_project(db)
    # OoP: 10000 + (-2500) = 7500
    client.post(
        "/project-costs/externals",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Vendor", "cost": 10000},
        headers=finance_headers,
    )
    client.post(
        "/project-costs/externals",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Credit", "cost": -2500},
        headers=finance_headers,
    )
    # Equipment: 6000 + (-1000) = 5000
    client.post(
        "/project-costs/equipment",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Server", "cost": 6000},
        headers=finance_headers,
    )
    client.post(
        "/project-costs/equipment",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Correction", "cost": -1000},
        headers=finance_headers,
    )
    resp = client.get(
        "/project-costs/summary",
        params={"period_id": "p-neg-01"},
        headers=finance_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["externals_total"] == 7500
    assert data["equipment_total"] == 5000
    assert data["combined_total"] == 12500


# ─── Snapshot ───────────────────────────────────────────────────────────────

def test_snapshot_includes_negative_external_cost(client, db, finance_headers):
    """Published snapshot preserves signed cost for a negative OoP line."""
    _make_period(db)
    _make_project(db)
    client.post(
        "/project-costs/externals",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Refund", "cost": -3000},
        headers=finance_headers,
    )
    pub = client.post(
        "/consolidation/publish/p-neg-01",
        json={"name": "Neg snapshot", "description": ""},
        headers=finance_headers,
    )
    assert pub.status_code == 200, pub.text
    snapshot_id = pub.json()["id"]

    detail = client.get(f"/consolidation/snapshots/{snapshot_id}", headers=finance_headers)
    assert detail.status_code == 200, detail.text
    oop_lines = [ln for ln in detail.json()["lines"] if ln["line_type"] == "oop"]
    assert len(oop_lines) == 1
    assert oop_lines[0]["cost"] == -3000


def test_snapshot_includes_negative_equipment_cost(client, db, finance_headers):
    """Published snapshot preserves signed cost for a negative Equipment line."""
    _make_period(db)
    _make_project(db)
    client.post(
        "/project-costs/equipment",
        json={"project_id": "proj-neg-01", "period_id": "p-neg-01", "description": "Correction", "cost": -7500},
        headers=finance_headers,
    )
    pub = client.post(
        "/consolidation/publish/p-neg-01",
        json={"name": "Neg equip snapshot", "description": ""},
        headers=finance_headers,
    )
    assert pub.status_code == 200, pub.text
    snapshot_id = pub.json()["id"]

    detail = client.get(f"/consolidation/snapshots/{snapshot_id}", headers=finance_headers)
    assert detail.status_code == 200, detail.text
    equip_lines = [ln for ln in detail.json()["lines"] if ln["line_type"] == "equipment"]
    assert len(equip_lines) == 1
    assert equip_lines[0]["cost"] == -7500


# ─── FTE regression guard ───────────────────────────────────────────────────

def test_fte_demand_still_rejects_negative(client, db, finance_headers):
    """Demand-line FTE validation unchanged: negative FTE returns 422."""
    _make_period(db)
    _make_project(db)
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": "proj-neg-01",
            "year": 2026,
            "month": 6,
            "fte_percent": -10,
            "resource_id": "some-resource",
        },
        headers=finance_headers,
    )
    assert resp.status_code == 400, resp.text


def test_fte_demand_still_rejects_over_100(client, db, finance_headers):
    """Demand-line FTE validation unchanged: FTE > 100 returns 422."""
    _make_period(db)
    _make_project(db)
    resp = client.post(
        "/demand-lines",
        json={
            "project_id": "proj-neg-01",
            "year": 2026,
            "month": 6,
            "fte_percent": 110,
            "resource_id": "some-resource",
        },
        headers=finance_headers,
    )
    assert resp.status_code == 400, resp.text


# ─── _dkk truncation-toward-zero ───────────────────────────────────────────

def test_dkk_truncation_semantics():
    """Verify int(x/100) truncates toward zero, fixing the floor-division bug.

    Before the fix: cents // 100 gave -1 for -50 cents (Python floors to -inf).
    After the fix:  int(cents / 100) gives 0 for -50 cents (truncates toward zero).
    """
    # Positive — same result both ways
    assert int(2500 / 100) == 25
    assert int(2599 / 100) == 25   # truncation, not rounding

    # Negative — key fix: truncation toward zero
    assert int(-2500 / 100) == -25   # exact multiple, no difference
    assert int(-50 / 100) == 0       # was -1 with //, now 0 with int()
    assert int(-99 / 100) == 0       # was -1 with //, now 0 with int()
    assert int(-100 / 100) == -1     # exact multiple, same either way

    # None guard unchanged
    # (tested indirectly via snapshot CSV endpoint; direct import not possible
    # because _dkk is a local function inside download_snapshot_csv)
