"""
Tests for Finance/Admin approval-routing patch (actuals.py create()).

Root cause fixed: Finance/Admin-created actuals were inserted unsigned with no
ApprovalInstance because create() had no auto-sign branch for those roles.

What these tests verify
-----------------------
1. Finance/Admin actuals are auto-signed on create (employee_signed_at set, is_proxy_signed=True).
2. Step 1 approver_id == resource employee's direct manager (via manager_object_id hierarchy).
3. Step 1 approver is NOT the Finance/Admin creator.
4. proxy_sign_reason is preserved when supplied; defaults to a non-empty string when omitted.
5. Finance and Admin route to the same approver for the same resource (role-agnostic routing).
6. Regression: Employee, Manager, and PM create paths are unaffected.
"""
import pytest
from sqlalchemy import and_

from api.app.models.actuals import ActualLine
from api.app.models.approvals import ApprovalInstance, ApprovalStep, StepStatus


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _setup_scenario(db, tenant_id: str) -> dict:
    """
    Create minimal DB fixtures for Finance/Admin routing tests.

    Manager hierarchy:
        manager_user <- employee_user.manager_object_id
        employee_user -> resource  (via Resource.user_id)

    CostCenter.ro_user_id is set to manager_user so that:
    - Approval routing via hierarchy returns manager (primary path).
    - Manager role can also write to the resource via CC fallback (needed for parity test).
    - If hierarchy routing breaks and falls back to CC, the test still detects the correct
      manager rather than silently passing with a wrong approver.
    """
    from api.app.models.core import User, CostCenter, Resource, Period, Project

    manager = User(
        id=f"{tenant_id}-mgr",
        tenant_id=tenant_id,
        object_id=f"{tenant_id}-mgr-oid",
        email="manager@fatest.com",
        display_name="FA Test Manager",
        role="Manager",
        is_active=True,
    )
    db.add(manager)
    db.flush()  # ensure manager.id is available before building employee

    employee = User(
        id=f"{tenant_id}-emp",
        tenant_id=tenant_id,
        object_id=f"{tenant_id}-emp-oid",
        email="employee@fatest.com",
        display_name="FA Test Employee",
        role="Employee",
        is_active=True,
        # Points to manager so _resolve_direct_manager uses the hierarchy path
        manager_object_id=f"{tenant_id}-mgr-oid",
    )
    db.add(employee)

    cc = CostCenter(
        id=f"{tenant_id}-cc",
        tenant_id=tenant_id,
        name="FA Test CC",
        code=f"FA{tenant_id[:8]}",
        # ro_user_id = manager.id enables Manager CC-fallback write access
        # and matches hierarchy routing, so both paths agree on the approver
        ro_user_id=f"{tenant_id}-mgr",
    )
    db.add(cc)

    resource = Resource(
        id=f"{tenant_id}-res",
        tenant_id=tenant_id,
        display_name="FA Test Resource",
        email="res@fatest.com",
        user_id=f"{tenant_id}-emp",
        cost_center_id=f"{tenant_id}-cc",
        employee_id=f"FAEMP{tenant_id[:8]}",
    )
    db.add(resource)

    period = Period(
        id=f"{tenant_id}-per",
        tenant_id=tenant_id,
        year=2026,
        month=6,
        status="open",
    )
    db.add(period)

    project = Project(
        id=f"{tenant_id}-prj",
        tenant_id=tenant_id,
        name="FA Test Project",
        code=f"FAPRJ{tenant_id[:8]}",
    )
    db.add(project)
    db.commit()

    return {
        "manager_id": f"{tenant_id}-mgr",
        "manager_oid": f"{tenant_id}-mgr-oid",
        "employee_id": f"{tenant_id}-emp",
        "employee_oid": f"{tenant_id}-emp-oid",
        "resource_id": f"{tenant_id}-res",
        "project_id": f"{tenant_id}-prj",
    }


def _h(role: str, tenant_id: str, user_oid: str) -> dict:
    """Build dev-bypass headers."""
    return {
        "X-Dev-Role": role,
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": user_oid,
    }


def _get_instance_and_step1(db, actual_id: str):
    """Return (ApprovalInstance, step-1 ApprovalStep) for an actual, or (None, None)."""
    instance = (
        db.query(ApprovalInstance)
        .filter(
            and_(
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id == actual_id,
            )
        )
        .order_by(ApprovalInstance.created_at.desc())
        .first()
    )
    if not instance:
        return None, None
    step1 = (
        db.query(ApprovalStep)
        .filter(
            and_(
                ApprovalStep.instance_id == instance.id,
                ApprovalStep.step_order == 1,
            )
        )
        .first()
    )
    return instance, step1


def _post_actual(client, tenant_id, role, user_oid, ids, month=6, reason=None, fte=50):
    payload = {
        "resource_id": ids["resource_id"],
        "project_id": ids["project_id"],
        "year": 2026,
        "month": month,
        "actual_fte_percent": fte,
    }
    if reason is not None:
        payload["proxy_sign_reason"] = reason
    return client.post("/actuals", json=payload, headers=_h(role, tenant_id, user_oid))


# ---------------------------------------------------------------------------
# Finance: auto-sign and metadata
# ---------------------------------------------------------------------------


def test_finance_create_auto_signs_actual(client, db):
    """Finance-created actual must be auto-signed (employee_signed_at set)."""
    tid = "ft-autosign"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Finance", "fin-oid", ids)
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.employee_signed_at is not None, "employee_signed_at must be set after Finance create"
    assert actual.employee_signed_by == "fin-oid"
    assert bool(actual.is_proxy_signed), "is_proxy_signed must be True for Finance-created actual"


def test_finance_create_proxy_sign_reason_preserved(client, db):
    """Finance-created actual must store the explicitly supplied proxy_sign_reason."""
    tid = "ft-reason-kept"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Finance", "fin-oid", ids, reason="Month-end corrective entry")
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.proxy_sign_reason == "Month-end corrective entry"


def test_finance_create_default_proxy_sign_reason_non_empty(client, db):
    """Finance-created actual must have a non-empty proxy_sign_reason when none is supplied."""
    tid = "ft-reason-default"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Finance", "fin-oid", ids)
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.proxy_sign_reason, "proxy_sign_reason must not be empty or None"
    assert "Finance" in actual.proxy_sign_reason, (
        f"Default reason should mention the role, got: {actual.proxy_sign_reason!r}"
    )


# ---------------------------------------------------------------------------
# Finance: approval instance creation and routing
# ---------------------------------------------------------------------------


def test_finance_create_generates_approval_instance(client, db):
    """Finance-created actual must produce a pending ApprovalInstance."""
    tid = "ft-instance"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Finance", "fin-oid", ids)
    assert resp.status_code == 200, resp.text

    instance, _ = _get_instance_and_step1(db, resp.json()["id"])
    assert instance is not None, "ApprovalInstance must be created after Finance create"
    assert instance.status == "pending"


def test_finance_create_routes_step1_to_employee_manager(client, db):
    """
    Finance-created actual: Step 1 approver must be the resource employee's direct manager
    (resolved via employee_user.manager_object_id), not the Finance user.
    """
    tid = "ft-routing"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Finance", "fin-oid", ids)
    assert resp.status_code == 200, resp.text

    instance, step1 = _get_instance_and_step1(db, resp.json()["id"])
    assert instance is not None
    assert step1 is not None
    assert step1.status == StepStatus.PENDING, (
        "Step 1 must be PENDING; SKIPPED would mean manager resolution failed"
    )
    assert step1.approver_id == ids["manager_id"], (
        f"Step 1 must point to employee's manager {ids['manager_id']!r}, "
        f"got {step1.approver_id!r}"
    )
    # Routing must NOT target the Finance user (Finance has no DB User record in this test,
    # but the approver_id is a User.id UUID, not an object_id — so the check is by value)
    assert step1.approver_id != "fin-oid", "Finance user's object_id must not appear as approver"


def test_finance_manager_sees_finance_created_actual_in_inbox(client, db):
    """The employee's manager must see Finance-created actuals in their approval inbox."""
    tid = "ft-inbox"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Finance", "fin-oid", ids)
    assert resp.status_code == 200, resp.text

    manager_h = _h("Manager", tid, ids["manager_oid"])
    inbox = client.get("/approvals/inbox", headers=manager_h).json()
    assert any(
        item["subject_id"] == resp.json()["id"] for item in inbox
    ), "Manager must see Finance-created actual in their inbox"


# ---------------------------------------------------------------------------
# Admin: auto-sign and routing
# ---------------------------------------------------------------------------


def test_admin_create_auto_signs_actual(client, db):
    """Admin-created actual must be auto-signed (employee_signed_at set, is_proxy_signed=True)."""
    tid = "at-autosign"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Admin", "adm-oid", ids)
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.employee_signed_at is not None, "employee_signed_at must be set after Admin create"
    assert actual.employee_signed_by == "adm-oid"
    assert bool(actual.is_proxy_signed), "is_proxy_signed must be True for Admin-created actual"


def test_admin_create_generates_approval_instance(client, db):
    """Admin-created actual must produce a pending ApprovalInstance."""
    tid = "at-instance"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Admin", "adm-oid", ids)
    assert resp.status_code == 200, resp.text

    instance, _ = _get_instance_and_step1(db, resp.json()["id"])
    assert instance is not None, "ApprovalInstance must be created after Admin create"
    assert instance.status == "pending"


def test_admin_create_routes_step1_to_employee_manager(client, db):
    """Admin-created actual: Step 1 approver must be the resource employee's manager, not Admin."""
    tid = "at-routing"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Admin", "adm-oid", ids)
    assert resp.status_code == 200, resp.text

    instance, step1 = _get_instance_and_step1(db, resp.json()["id"])
    assert instance is not None
    assert step1 is not None
    assert step1.status == StepStatus.PENDING, "Step 1 must be PENDING (not SKIPPED)"
    assert step1.approver_id == ids["manager_id"], (
        f"Step 1 must point to employee's manager {ids['manager_id']!r}, "
        f"got {step1.approver_id!r}"
    )
    assert step1.approver_id != "adm-oid"


def test_admin_create_proxy_sign_reason_preserved(client, db):
    """Admin-created actual must store the explicitly supplied proxy_sign_reason."""
    tid = "at-reason-kept"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Admin", "adm-oid", ids, reason="Admin correction")
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.proxy_sign_reason == "Admin correction"


def test_admin_create_default_proxy_sign_reason_non_empty(client, db):
    """Admin-created actual must have a non-empty proxy_sign_reason when none is supplied."""
    tid = "at-reason-default"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Admin", "adm-oid", ids)
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.proxy_sign_reason, "proxy_sign_reason must not be empty or None"
    assert "Admin" in actual.proxy_sign_reason, (
        f"Default reason should mention the role, got: {actual.proxy_sign_reason!r}"
    )


# ---------------------------------------------------------------------------
# Parity: Finance and Admin route to the same approver for the same resource
# ---------------------------------------------------------------------------


def test_finance_and_admin_route_to_same_approver_same_resource(client, db):
    """
    Finance and Admin creating actuals for the same resource (different months) must
    produce identical Step 1 approver_id.  This proves routing is resource-owner-based,
    not creator-role-based.
    """
    from api.app.models.core import Period

    tid = "parity-fa"
    ids = _setup_scenario(db, tid)

    # Add a second open period for month=7 (month=6 already created by _setup_scenario)
    db.add(Period(id=f"{tid}-per7", tenant_id=tid, year=2026, month=7, status="open"))
    db.commit()

    fin_resp = _post_actual(client, tid, "Finance", "fin-oid", ids, month=6)
    adm_resp = _post_actual(client, tid, "Admin", "adm-oid", ids, month=7)
    assert fin_resp.status_code == 200, fin_resp.text
    assert adm_resp.status_code == 200, adm_resp.text

    _, fin_step1 = _get_instance_and_step1(db, fin_resp.json()["id"])
    _, adm_step1 = _get_instance_and_step1(db, adm_resp.json()["id"])

    assert fin_step1 is not None and adm_step1 is not None
    assert fin_step1.approver_id == adm_step1.approver_id, (
        f"Finance step1={fin_step1.approver_id!r} != Admin step1={adm_step1.approver_id!r}; "
        "routing must depend on resource, not on creator role"
    )
    # Both must point to the employee's manager
    assert fin_step1.approver_id == ids["manager_id"]


# ---------------------------------------------------------------------------
# Regression: existing create paths must be unaffected
# ---------------------------------------------------------------------------


def test_regression_employee_create_auto_signs_not_proxy(client, db):
    """Employee creating their own actual must still auto-sign with is_proxy_signed=False."""
    tid = "reg-employee"
    ids = _setup_scenario(db, tid)

    # Employee creates for their own resource
    resp = _post_actual(client, tid, "Employee", ids["employee_oid"], ids)
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.employee_signed_at is not None
    assert not bool(actual.is_proxy_signed), "Employee own-actual must NOT be proxy-signed"
    assert actual.employee_signed_by == ids["employee_oid"]

    instance, step1 = _get_instance_and_step1(db, resp.json()["id"])
    assert instance is not None, "ApprovalInstance must still be created for Employee"


def test_regression_manager_proxy_create_still_works(client, db):
    """Manager creating for a team member must still auto-sign as proxy and route to that manager."""
    tid = "reg-manager"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(
        client, tid, "Manager", ids["manager_oid"], ids,
        reason="Entering on behalf of absent employee",
    )
    assert resp.status_code == 200, resp.text

    actual = db.query(ActualLine).filter(ActualLine.id == resp.json()["id"]).first()
    assert actual.employee_signed_at is not None
    assert bool(actual.is_proxy_signed), "Manager-for-employee must be proxy-signed"
    assert actual.proxy_sign_reason == "Entering on behalf of absent employee"

    instance, step1 = _get_instance_and_step1(db, resp.json()["id"])
    assert instance is not None, "ApprovalInstance must be created for Manager-proxy create"
    # Manager IS the employee's manager, so step1 routes to themselves (correct)
    assert step1 is not None
    assert step1.approver_id == ids["manager_id"]


def test_regression_manager_create_without_reason_rejected(client, db):
    """Manager entering for another employee without a reason must still get 400."""
    tid = "reg-mgr-no-reason"
    ids = _setup_scenario(db, tid)

    resp = _post_actual(client, tid, "Manager", ids["manager_oid"], ids)
    assert resp.status_code == 400, (
        "Manager entering for another employee without proxy_sign_reason must be rejected"
    )
    assert resp.json().get("code") == "VALIDATION_ERROR"


def test_regression_employee_cannot_create_for_other_resource(client, db):
    """Employee still cannot create actuals for a resource they do not own."""
    from api.app.models.core import Resource

    tid = "reg-emp-other"
    ids = _setup_scenario(db, tid)

    # Create a second resource not linked to the employee
    other_res = Resource(
        id=f"{tid}-other-res",
        tenant_id=tid,
        display_name="Other Resource",
        email="other@fatest.com",
        user_id=None,
        cost_center_id=f"{tid}-cc",
        employee_id=f"OTHR{tid[:6]}",
    )
    db.add(other_res)
    db.commit()

    resp = _post_actual(client, tid, "Employee", ids["employee_oid"], {
        **ids,
        "resource_id": f"{tid}-other-res",
    })
    assert resp.status_code == 403
    assert resp.json().get("code") == "UNAUTHORIZED_RESOURCE"
