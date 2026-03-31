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
        pm_user_id=None,
    )
    db.add(project)
    db.commit()
    
    # Create and sign actuals as employee (triggers approval instance)
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
    actual_id = create_resp.json()["id"]
    sign_resp = client.post(f"/actuals/{actual_id}/sign", headers=employee_headers)
    assert sign_resp.status_code == 200

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
        pm_user_id=None,
    )
    db.add(project)
    
    db.commit()
    
    # Create and sign actuals as employee (triggers approval instance)
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
    actual_id = create_resp.json()["id"]
    sign_resp = client.post(f"/actuals/{actual_id}/sign", headers=employee_headers)
    assert sign_resp.status_code == 200

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
