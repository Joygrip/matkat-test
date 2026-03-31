"""Tests for ConflictDetectionService."""
import pytest
from api.app.services.conflict_detection import ConflictDetectionService


TENANT = "test-tenant"


def _make_cost_center(db, cc_id, ro_user_id=None):
    from api.app.models.core import CostCenter
    cc = CostCenter(
        id=cc_id,
        tenant_id=TENANT,
        code=cc_id,
        name=f"CC {cc_id}",
        ro_user_id=ro_user_id,
    )
    db.add(cc)
    return cc


def _make_user(db, user_id, role="Manager", email=None):
    from api.app.models.core import User
    u = User(
        id=user_id,
        tenant_id=TENANT,
        object_id=user_id,
        email=email or f"{user_id}@test.com",
        display_name=user_id,
        role=role,
        is_active=True,
    )
    db.add(u)
    return u


def _make_resource(db, resource_id, cc_id):
    from api.app.models.core import Resource
    r = Resource(
        id=resource_id,
        tenant_id=TENANT,
        cost_center_id=cc_id,
        employee_id=resource_id,
        display_name=resource_id,
        resource_type="Employee",
        is_active=True,
    )
    db.add(r)
    return r


def _make_project(db, project_id, pm_user_id=None):
    from api.app.models.core import Project
    p = Project(
        id=project_id,
        tenant_id=TENANT,
        code=project_id,
        name=project_id,
        pm_user_id=pm_user_id,
    )
    db.add(p)
    return p


def _make_period(db, period_id, year=2026, month=3):
    from api.app.models.core import Period
    p = Period(
        id=period_id,
        tenant_id=TENANT,
        year=year,
        month=month,
        status="open",
    )
    db.add(p)
    return p


def _make_demand(db, resource_id, project_id, period_id, fte, year=2026, month=3):
    from api.app.models.planning import DemandLine
    d = DemandLine(
        tenant_id=TENANT,
        period_id=period_id,
        resource_id=resource_id,
        project_id=project_id,
        year=year,
        month=month,
        fte_percent=fte,
        created_by="system",
    )
    db.add(d)
    return d


def _make_supply(db, resource_id, period_id, fte, year=2026, month=3, project_id=None):
    from api.app.models.planning import SupplyLine
    s = SupplyLine(
        tenant_id=TENANT,
        period_id=period_id,
        resource_id=resource_id,
        project_id=project_id,
        year=year,
        month=month,
        fte_percent=fte,
        created_by="system",
    )
    db.add(s)
    return s


def test_no_conflicts_when_supply_covers_demand(db):
    period = _make_period(db, "p1")
    _make_cost_center(db, "cc1")
    _make_resource(db, "r1", "cc1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1", fte=50)
    _make_supply(db, "r1", "p1", fte=50)
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert conflicts == []


def test_conflict_detected_demand_exceeds_supply(db):
    period = _make_period(db, "p1")
    _make_cost_center(db, "cc1")
    _make_resource(db, "r1", "cc1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1", fte=75)
    _make_supply(db, "r1", "p1", fte=50)
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert len(conflicts) == 1
    assert conflicts[0].total_demand == 75
    assert conflicts[0].total_supply == 50
    assert conflicts[0].resource_id == "r1"


def test_no_supply_counts_as_zero(db):
    """A resource with demand but no supply lines at all should be detected as a conflict."""
    period = _make_period(db, "p1")
    _make_cost_center(db, "cc1")
    _make_resource(db, "r1", "cc1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1", fte=50)
    # No supply line
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert len(conflicts) == 1
    assert conflicts[0].total_supply == 0


def test_placeholder_demand_excluded(db):
    """Demand lines with resource_id=NULL (placeholder) must not trigger conflict."""
    from api.app.models.planning import DemandLine
    from api.app.models.core import Placeholder

    period = _make_period(db, "p1")
    cc = _make_cost_center(db, "cc1")
    _make_project(db, "proj1")

    ph = Placeholder(
        id="ph1",
        tenant_id=TENANT,
        cost_center_id="cc1",
        name="Placeholder 1",
    )
    db.add(ph)

    demand = DemandLine(
        tenant_id=TENANT,
        period_id="p1",
        resource_id=None,
        placeholder_id="ph1",
        project_id="proj1",
        year=2026,
        month=3,
        fte_percent=50,
        created_by="system",
    )
    db.add(demand)
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert conflicts == []


def test_ro_recipient_resolved(db):
    ro = _make_user(db, "ro-user", role="Manager")
    _make_cost_center(db, "cc1", ro_user_id="ro-user")
    _make_resource(db, "r1", "cc1")
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1", fte=75)
    _make_supply(db, "r1", "p1", fte=25)
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert len(conflicts) == 1
    assert conflicts[0].ro_recipient is not None
    assert conflicts[0].ro_recipient.id == "ro-user"


def test_pm_recipients_resolved_per_project(db):
    """Multiple PMs (one per project) should all appear in pm_recipients."""
    pm1 = _make_user(db, "pm1", role="PM")
    pm2 = _make_user(db, "pm2", role="PM")
    _make_cost_center(db, "cc1")
    _make_resource(db, "r1", "cc1")
    _make_project(db, "proj1", pm_user_id="pm1")
    _make_project(db, "proj2", pm_user_id="pm2")
    period = _make_period(db, "p1")
    _make_demand(db, "r1", "proj1", "p1", fte=50)
    _make_demand(db, "r1", "proj2", "p1", fte=50)
    # No supply — both lines create 100% demand vs 0 supply
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert len(conflicts) == 1
    pm_ids = {u.id for u in conflicts[0].pm_recipients}
    assert "pm1" in pm_ids
    assert "pm2" in pm_ids


def test_no_conflict_when_demand_equals_supply(db):
    period = _make_period(db, "p1")
    _make_cost_center(db, "cc1")
    _make_resource(db, "r1", "cc1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1", fte=100)
    _make_supply(db, "r1", "p1", fte=100)
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert conflicts == []


def test_multiple_demand_lines_summed(db):
    """Total demand across multiple projects for same resource must be summed."""
    period = _make_period(db, "p1")
    _make_cost_center(db, "cc1")
    _make_resource(db, "r1", "cc1")
    _make_project(db, "proj1")
    _make_project(db, "proj2")
    _make_demand(db, "r1", "proj1", "p1", fte=50)
    _make_demand(db, "r1", "proj2", "p1", fte=50)
    _make_supply(db, "r1", "p1", fte=75)
    db.commit()

    svc = ConflictDetectionService(db, TENANT)
    conflicts = svc.find_conflicts(2026, 3)
    assert len(conflicts) == 1
    assert conflicts[0].total_demand == 100
    assert conflicts[0].total_supply == 75
