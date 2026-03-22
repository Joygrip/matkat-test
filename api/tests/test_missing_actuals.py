"""Tests for MissingActualsService."""
import pytest
from datetime import datetime

from api.app.services.missing_actuals import MissingActualsService


TENANT = "test-tenant"


def _make_user(db, user_id, email=None):
    from api.app.models.core import User
    u = User(
        id=user_id,
        tenant_id=TENANT,
        object_id=user_id,
        email=email or f"{user_id}@test.com",
        display_name=user_id,
        role="Employee",
        is_active=True,
    )
    db.add(u)
    return u


def _make_resource(db, resource_id, user_id=None):
    from api.app.models.core import CostCenter, Resource
    cc_id = f"cc-{resource_id}"
    if not db.query(CostCenter).filter_by(id=cc_id).first():
        db.add(CostCenter(id=cc_id, tenant_id=TENANT, code=cc_id, name=cc_id))
    r = Resource(
        id=resource_id,
        tenant_id=TENANT,
        cost_center_id=cc_id,
        employee_id=resource_id,
        display_name=resource_id,
        resource_type="Employee",
        user_id=user_id,
        is_active=True,
    )
    db.add(r)
    return r


def _make_period(db, period_id, year=2026, month=3):
    from api.app.models.core import Period
    p = Period(id=period_id, tenant_id=TENANT, year=year, month=month, status="open")
    db.add(p)
    return p


def _make_project(db, project_id):
    from api.app.models.core import Project
    p = Project(id=project_id, tenant_id=TENANT, code=project_id, name=project_id)
    db.add(p)
    return p


def _make_demand(db, resource_id, project_id, period_id, fte=50, year=2026, month=3):
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


def _make_actual(db, resource_id, project_id, period_id, signed=False, year=2026, month=3):
    from api.app.models.actuals import ActualLine
    a = ActualLine(
        tenant_id=TENANT,
        period_id=period_id,
        resource_id=resource_id,
        project_id=project_id,
        year=year,
        month=month,
        actual_fte_percent=50,
        created_by="system",
        employee_signed_at=datetime.utcnow() if signed else None,
    )
    db.add(a)
    return a


def test_resource_with_signed_actuals_excluded(db):
    user = _make_user(db, "emp1")
    _make_resource(db, "r1", user_id="emp1")
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1")
    _make_actual(db, "r1", "proj1", "p1", signed=True)
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert results == []


def test_resource_with_no_actuals_included(db):
    user = _make_user(db, "emp1")
    _make_resource(db, "r1", user_id="emp1")
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1")
    # No actual lines at all
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert len(results) == 1
    assert results[0].resource_id == "r1"


def test_resource_with_unsigned_actuals_included(db):
    user = _make_user(db, "emp1")
    _make_resource(db, "r1", user_id="emp1")
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1")
    _make_actual(db, "r1", "proj1", "p1", signed=False)
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert len(results) == 1
    assert results[0].resource_id == "r1"


def test_resource_with_partial_unsigned_included(db):
    """If any actual is unsigned the resource should appear in results."""
    user = _make_user(db, "emp1")
    _make_resource(db, "r1", user_id="emp1")
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_project(db, "proj2")
    _make_demand(db, "r1", "proj1", "p1", fte=50)
    _make_demand(db, "r1", "proj2", "p1", fte=50)
    _make_actual(db, "r1", "proj1", "p1", signed=True)
    _make_actual(db, "r1", "proj2", "p1", signed=False)  # one unsigned
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert len(results) == 1
    assert results[0].resource_id == "r1"


def test_resource_without_user_id_excluded(db):
    """Resources without a linked user_id have no email to notify — skip them."""
    _make_resource(db, "r1", user_id=None)  # no user
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1")
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert results == []


def test_recipient_is_linked_employee_user(db):
    user = _make_user(db, "emp1", email="emp1@company.com")
    _make_resource(db, "r1", user_id="emp1")
    period = _make_period(db, "p1")
    _make_project(db, "proj1")
    _make_demand(db, "r1", "proj1", "p1")
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert len(results) == 1
    assert results[0].recipient.id == "emp1"
    assert results[0].recipient.email == "emp1@company.com"


def test_no_demand_no_results(db):
    """Resources without any demand lines should not appear."""
    user = _make_user(db, "emp1")
    _make_resource(db, "r1", user_id="emp1")
    _make_period(db, "p1")
    db.commit()

    svc = MissingActualsService(db, TENANT)
    results = svc.find_missing(2026, 3)
    assert results == []
