"""Tests for approvals endpoints."""
import pytest
from datetime import datetime


def test_inbox_requires_role(client):
    """Test that inbox requires Manager role."""
    # Without auth headers in dev mode, defaults to Employee which can't approve
    response = client.get("/approvals/inbox")
    assert response.status_code == 403


def test_inbox_returns_empty_list(client):
    """Test that inbox returns empty list when no pending approvals."""
    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": "test-tenant"}

    response = client.get("/approvals/inbox", headers=headers)
    assert response.status_code == 200
    assert response.json() == []


def test_approval_not_found(client):
    """Test getting non-existent approval."""
    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get("/approvals/non-existent-id", headers=headers)
    assert response.status_code == 404


def test_full_approval_workflow(client, db):
    """Test complete approval workflow: sign → Manager approve → Senior Manager approve."""
    from api.app.models.core import User, CostCenter, Resource, Period, Project

    tenant_id = "test-tenant"

    ro_user = User(
        id="ro-user-1",
        tenant_id=tenant_id,
        object_id="ro-oid",
        email="ro@test.com",
        display_name="Manager User",
        role="Manager",
    )
    db.add(ro_user)

    director_user = User(
        id="director-user-1",
        tenant_id=tenant_id,
        object_id="director-oid",
        email="director@test.com",
        display_name="Senior Manager User",
        role="Manager",
    )
    db.add(director_user)

    cost_center = CostCenter(
        id="cc-1",
        tenant_id=tenant_id,
        name="Test CC",
        code="TCC",
        ro_user_id="ro-user-1",
        director_user_id="director-user-1",
    )
    db.add(cost_center)
    
    # Create employee user (needed for ownership check)
    employee_user = User(
        id="employee-user-1",
        tenant_id=tenant_id,
        object_id="employee-oid",
        email="employee@test.com",
        display_name="Employee User",
        role="Employee",
    )
    db.add(employee_user)

    # Create resource linked to employee user
    resource = Resource(
        id="res-1",
        tenant_id=tenant_id,
        display_name="Test Resource",
        email="resource@test.com",
        user_id="employee-user-1",
        cost_center_id="cc-1",
        employee_id="EMP001",
    )
    db.add(resource)
    
    # Create period
    period = Period(
        id="period-1",
        tenant_id=tenant_id,
        year=2026,
        month=2,
        status="open",
    )
    db.add(period)
    
    # Create project
    project = Project(
        id="proj-1",
        tenant_id=tenant_id,
        name="Test Project",
        code="TP",
    )
    db.add(project)
    db.commit()
    
    # Create actuals as employee — auto-signed on create, approval instance is created
    employee_headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "employee-oid"}
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": "res-1",
            "project_id": "proj-1",
            "year": 2026,
            "month": 2,
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    assert create_resp.status_code == 200

    # Manager (step 1) should see approval in inbox
    manager_headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "ro-oid"}

    response = client.get("/approvals/inbox", headers=manager_headers)
    assert response.status_code == 200
    inbox = response.json()
    assert len(inbox) == 1
    approval_id = inbox[0]["id"]
    assert inbox[0]["status"] == "pending"
    manager_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "Manager")
    senior_manager_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "Senior Manager")

    # Manager approves step 1
    response = client.post(
        f"/approvals/{approval_id}/steps/{manager_step['id']}/approve",
        json={"comment": "Looks good"},
        headers=manager_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "pending"  # Still pending (Senior Manager step remains)

    # Senior Manager approves step 2
    senior_manager_headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "director-oid"}

    response = client.post(
        f"/approvals/{approval_id}/steps/{senior_manager_step['id']}/approve",
        json={"comment": "Approved by Senior Manager"},
        headers=senior_manager_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "approved"  # Now fully approved


def test_skip_director_when_ro_equals_director(client, db):
    """Test that Senior Manager step is skipped when manager and senior manager are the same person."""
    from api.app.models.core import User, CostCenter, Resource, Period, Project

    tenant_id = "test-tenant"

    ro_director_user = User(
        id="ro-director-user",
        tenant_id=tenant_id,
        object_id="ro-director-oid",
        email="ro-director@test.com",
        display_name="Manager User",
        role="Manager",
    )
    db.add(ro_director_user)

    cost_center = CostCenter(
        id="cc-2",
        tenant_id=tenant_id,
        name="Test CC 2",
        code="TCC2",
        ro_user_id="ro-director-user",
        director_user_id="ro-director-user",
    )
    db.add(cost_center)

    employee_user = User(
        id="employee-user-2",
        tenant_id=tenant_id,
        object_id="employee-oid",
        email="employee@test.com",
        display_name="Employee User 2",
        role="Employee",
    )
    db.add(employee_user)

    # Create resource linked to employee user
    resource = Resource(
        id="res-2",
        tenant_id=tenant_id,
        display_name="Test Resource 2",
        email="resource2@test.com",
        user_id="employee-user-2",
        cost_center_id="cc-2",
        employee_id="EMP002",
    )
    db.add(resource)

    # Create period
    period = Period(
        id="period-2",
        tenant_id=tenant_id,
        year=2026,
        month=2,
        status="open",
    )
    db.add(period)

    # Create project
    project = Project(
        id="proj-2",
        tenant_id=tenant_id,
        name="Test Project 2",
        code="TP2",
    )
    db.add(project)
    
    db.commit()
    
    # Create actuals as employee — auto-signed on create, approval instance is created
    employee_headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "employee-oid"}
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": "res-2",
            "project_id": "proj-2",
            "year": 2026,
            "month": 2,
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    assert create_resp.status_code == 200

    # When manager approves, the whole instance should be approved (Senior Manager skipped)
    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "ro-director-oid"}

    inbox_resp = client.get("/approvals/inbox", headers=headers)
    assert inbox_resp.status_code == 200
    inbox = inbox_resp.json()
    assert len(inbox) == 1
    approval_id = inbox[0]["id"]
    manager_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "Manager")
    senior_manager_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "Senior Manager")
    assert senior_manager_step["status"] == "skipped"

    response = client.post(
        f"/approvals/{approval_id}/steps/{manager_step['id']}/approve",
        json={"comment": "Single-approver approval"},
        headers=headers,
    )
    assert response.status_code == 200
    result = response.json()

    # Should be fully approved since Senior Manager step was skipped
    assert result["status"] == "approved"

    # Verify steps
    steps = {s["step_name"]: s["status"] for s in result["steps"]}
    assert steps["Manager"] == "approved"
    assert steps["Senior Manager"] == "skipped"


def test_rejection_sets_instance_rejected(client, db):
    """Test that rejection sets the instance status to rejected."""
    from api.app.models.core import User
    from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus

    tenant_id = "test-tenant"

    ro_user = User(
        id="ro-user-3",
        tenant_id=tenant_id,
        object_id="ro-oid-3",
        email="ro3@test.com",
        display_name="Manager User 3",
        role="Manager",
    )
    db.add(ro_user)
    
    # Create approval instance
    instance = ApprovalInstance(
        id="approval-3",
        tenant_id=tenant_id,
        subject_type="actuals",
        subject_id="actual-3",
        status=ApprovalStatus.PENDING,
        created_by="employee",
    )
    db.add(instance)
    db.flush()
    
    # Manager step
    ro_step = ApprovalStep(
        id="step-5",
        instance_id="approval-3",
        step_order=1,
        step_name="Manager",
        approver_id="ro-user-3",
        status=StepStatus.PENDING,
    )
    db.add(ro_step)

    db.commit()

    # Manager rejects
    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "ro-oid-3"}
    
    response = client.post(
        "/approvals/approval-3/steps/step-5/reject",
        json={"comment": "Data is incorrect"},
        headers=headers,
    )
    assert response.status_code == 200
    result = response.json()
    
    # Instance should be rejected
    assert result["status"] == "rejected"
    assert result["steps"][0]["status"] == "rejected"
    assert result["steps"][0]["comment"] == "Data is incorrect"


def test_cannot_approve_already_actioned_step(client, db):
    """Test that already-approved/rejected step cannot be actioned again."""
    from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
    
    tenant_id = "test-tenant"
    
    # Create approval with already-approved step
    instance = ApprovalInstance(
        id="approval-4",
        tenant_id=tenant_id,
        subject_type="actuals",
        subject_id="actual-4",
        status=ApprovalStatus.PENDING,
        created_by="employee",
    )
    db.add(instance)
    db.flush()
    
    step = ApprovalStep(
        id="step-6",
        instance_id="approval-4",
        step_order=1,
        step_name="Manager",
        status=StepStatus.APPROVED,  # Already approved
    )
    db.add(step)
    db.commit()

    headers = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id}
    
    response = client.post(
        "/approvals/approval-4/steps/step-6/approve",
        json={},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_employee_cannot_access_inbox(client):
    """Test that Employee role cannot access approvals inbox."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}


    response = client.get("/approvals/inbox", headers=headers)
    assert response.status_code == 403


# ============== DELEGATION TESTS ==============

def _setup_delegation_scenario(db, tenant_id: str):
    """
    Set up a standard delegation test scenario and return a dict of IDs.

    Creates:
    - manager_user (the RO/approver for the cost center)
    - delegate_user (acting on behalf of manager)
    - employee_user (submitter of actuals)
    - cost_center (managed by manager_user as ro_user_id)
    - resource (linked to employee_user)
    - period (2026-04, open)
    - project
    - approval_delegate grant (manager -> delegate, active)
    """
    from api.app.models.core import (
        User, CostCenter, Resource, Period, Project, ApprovalDelegate
    )

    manager = User(
        id="del-manager-1",
        tenant_id=tenant_id,
        object_id="del-manager-oid",
        email="manager@delegate-test.com",
        display_name="Delegating Manager",
        role="Manager",
    )
    db.add(manager)

    delegate = User(
        id="del-delegate-1",
        tenant_id=tenant_id,
        object_id="del-delegate-oid",
        email="delegate@delegate-test.com",
        display_name="Delegate User",
        role="Manager",
    )
    db.add(delegate)

    employee = User(
        id="del-employee-1",
        tenant_id=tenant_id,
        object_id="del-employee-oid",
        email="emp@delegate-test.com",
        display_name="Delegate Test Employee",
        role="Employee",
    )
    db.add(employee)

    cc = CostCenter(
        id="del-cc-1",
        tenant_id=tenant_id,
        name="Delegation CC",
        code="DCC",
        ro_user_id="del-manager-1",
    )
    db.add(cc)

    resource = Resource(
        id="del-res-1",
        tenant_id=tenant_id,
        display_name="Delegate Test Resource",
        email="res@delegate-test.com",
        user_id="del-employee-1",
        cost_center_id="del-cc-1",
        employee_id="DEMP001",
    )
    db.add(resource)

    period = Period(
        id="del-period-1",
        tenant_id=tenant_id,
        year=2026,
        month=4,
        status="open",
    )
    db.add(period)

    project = Project(
        id="del-proj-1",
        tenant_id=tenant_id,
        name="Delegation Project",
        code="DPRJ",
    )
    db.add(project)

    grant = ApprovalDelegate(
        id="del-grant-1",
        tenant_id=tenant_id,
        delegator_id="del-manager-1",
        delegate_id="del-delegate-1",
        is_active=True,
        created_by="admin-oid",
    )
    db.add(grant)

    db.commit()
    return {
        "manager_oid": "del-manager-oid",
        "delegate_oid": "del-delegate-oid",
        "employee_oid": "del-employee-oid",
        "resource_id": "del-res-1",
        "project_id": "del-proj-1",
        "grant_id": "del-grant-1",
    }


def _sign_actual(client, tenant_id, employee_oid, resource_id, project_id):
    """Helper: create an actual as Employee (auto-signed on create), returning actual_id."""
    emp_h = {"X-Dev-Role": "Employee", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": employee_oid}
    r = client.post(
        "/actuals",
        json={"resource_id": resource_id, "project_id": project_id, "year": 2026, "month": 4, "actual_fte_percent": 50},
        headers=emp_h,
    )
    assert r.status_code == 200, r.text
    # Employee create auto-signs and creates approval instance; no separate sign call needed
    return r.json()["id"]


def test_delegate_sees_inbox_item(client, db):
    """Delegate should see approval inbox items for their delegator's resources."""
    tenant_id = "del-tenant"
    ids = _setup_delegation_scenario(db, tenant_id)

    _sign_actual(client, tenant_id, ids["employee_oid"], ids["resource_id"], ids["project_id"])

    delegate_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["delegate_oid"]}
    resp = client.get("/approvals/inbox", headers=delegate_h)
    assert resp.status_code == 200
    inbox = resp.json()
    assert len(inbox) == 1
    assert inbox[0]["is_delegated"] is True
    assert inbox[0]["delegated_for"] == "Delegating Manager"


def test_delegate_can_approve_step(client, db):
    """Delegate can approve a pending step for their delegator's resource."""
    tenant_id = "del-tenant-2"
    ids = _setup_delegation_scenario(db, tenant_id)

    _sign_actual(client, tenant_id, ids["employee_oid"], ids["resource_id"], ids["project_id"])

    delegate_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["delegate_oid"]}
    inbox = client.get("/approvals/inbox", headers=delegate_h).json()
    approval_id = inbox[0]["id"]
    step = next(s for s in inbox[0]["steps"] if s["step_name"] == "Manager")

    resp = client.post(
        f"/approvals/{approval_id}/steps/{step['id']}/approve",
        json={"comment": "Approved as delegate"},
        headers=delegate_h,
    )
    assert resp.status_code == 200
    result = resp.json()
    approved_step = next(s for s in result["steps"] if s["step_name"] == "Manager")
    assert approved_step["status"] == "approved"


def test_delegate_attribution_in_comment(client, db):
    """When a delegate approves, the comment should be prefixed with [DELEGATE for ...]."""
    from api.app.models.approvals import ApprovalAction

    tenant_id = "del-tenant-3"
    ids = _setup_delegation_scenario(db, tenant_id)

    _sign_actual(client, tenant_id, ids["employee_oid"], ids["resource_id"], ids["project_id"])

    delegate_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["delegate_oid"]}
    inbox = client.get("/approvals/inbox", headers=delegate_h).json()
    approval_id = inbox[0]["id"]
    step = next(s for s in inbox[0]["steps"] if s["step_name"] == "Manager")

    client.post(
        f"/approvals/{approval_id}/steps/{step['id']}/approve",
        json={"comment": "All good"},
        headers=delegate_h,
    )

    # Verify the audit action has the delegation prefix
    from api.app.models.approvals import ApprovalAction
    from sqlalchemy import and_
    session = db
    action = session.query(ApprovalAction).filter(
        and_(
            ApprovalAction.instance_id == approval_id,
            ApprovalAction.action == "approve",
        )
    ).first()
    assert action is not None
    assert "[DELEGATE for Delegating Manager]" in (action.comment or "")


def test_non_delegate_cannot_approve(client, db):
    """A user without a delegation grant should get 403 when trying to approve."""
    tenant_id = "del-tenant-4"
    ids = _setup_delegation_scenario(db, tenant_id)

    _sign_actual(client, tenant_id, ids["employee_oid"], ids["resource_id"], ids["project_id"])

    # Fetch the inbox as the manager (direct approver) to get the step ID
    manager_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["manager_oid"]}
    inbox = client.get("/approvals/inbox", headers=manager_h).json()
    approval_id = inbox[0]["id"]
    step = next(s for s in inbox[0]["steps"] if s["step_name"] == "Manager")

    # A completely unrelated manager tries to approve
    outsider_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "unrelated-manager-oid"}
    resp = client.post(
        f"/approvals/{approval_id}/steps/{step['id']}/approve",
        json={"comment": "Sneaky"},
        headers=outsider_h,
    )
    assert resp.status_code == 403


def test_inactive_delegate_cannot_approve(client, db):
    """A delegate with is_active=False should not be able to approve."""
    from api.app.models.core import ApprovalDelegate

    tenant_id = "del-tenant-5"
    ids = _setup_delegation_scenario(db, tenant_id)

    # Deactivate the grant
    grant = db.query(ApprovalDelegate).filter(ApprovalDelegate.id == ids["grant_id"]).first()
    grant.is_active = False
    db.commit()

    _sign_actual(client, tenant_id, ids["employee_oid"], ids["resource_id"], ids["project_id"])

    # Delegate should not see the inbox item
    delegate_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["delegate_oid"]}
    inbox = client.get("/approvals/inbox", headers=delegate_h).json()
    assert inbox == []


def test_delegate_sees_actuals_for_delegators_resources(client, db):
    """Delegate should be able to list actuals for their delegator's cost center resources."""
    tenant_id = "del-tenant-6"
    ids = _setup_delegation_scenario(db, tenant_id)

    # Create an actual (unsigned)
    manager_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["manager_oid"]}
    r = client.post(
        "/actuals",
        json={
            "resource_id": ids["resource_id"],
            "project_id": ids["project_id"],
            "year": 2026,
            "month": 4,
            "actual_fte_percent": 50,
            "proxy_sign_reason": "Manager entry on behalf of employee",
        },
        headers=manager_h,
    )
    assert r.status_code == 200

    # Delegate should see the actual in the list
    delegate_h = {"X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": ids["delegate_oid"]}
    resp = client.get("/actuals", headers=delegate_h)
    assert resp.status_code == 200
    actuals = resp.json()
    assert any(a["resource_id"] == ids["resource_id"] for a in actuals)
