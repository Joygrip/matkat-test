"""Tests for approvals endpoints."""
import pytest
from datetime import datetime


def test_inbox_requires_role(client):
    """Test that inbox requires approver role (RO/Director)."""
    # Without auth headers in dev mode, defaults to Employee which can't approve
    response = client.get("/approvals/inbox")
    assert response.status_code == 403


def test_inbox_returns_empty_list(client):
    """Test that inbox returns empty list when no pending approvals."""
    headers = {"X-Dev-Role": "RO", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get("/approvals/inbox", headers=headers)
    assert response.status_code == 200
    assert response.json() == []


def test_approval_not_found(client):
    """Test getting non-existent approval."""
    headers = {"X-Dev-Role": "RO", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get("/approvals/non-existent-id", headers=headers)
    assert response.status_code == 404


def test_full_approval_workflow(client, db):
    """Test complete approval workflow: sign → RO approve → Director approve."""
    from api.app.models.core import User, Department, CostCenter, Resource, Period, Project
    
    tenant_id = "test-tenant"
    
    # Create department
    dept = Department(
        id="dept-1",
        tenant_id=tenant_id,
        name="Test Dept",
        code="TD",
    )
    db.add(dept)
    
    # Create RO user
    ro_user = User(
        id="ro-user-1",
        tenant_id=tenant_id,
        object_id="ro-oid",
        email="ro@test.com",
        display_name="RO User",
        role="RO",
        department_id="dept-1",
    )
    db.add(ro_user)
    
    # Create Director user (different from RO)
    director_user = User(
        id="director-user-1",
        tenant_id=tenant_id,
        object_id="director-oid",
        email="director@test.com",
        display_name="Director User",
        role="Director",
        department_id="dept-1",
    )
    db.add(director_user)
    
    # Create cost center with RO
    cost_center = CostCenter(
        id="cc-1",
        tenant_id=tenant_id,
        name="Test CC",
        code="TCC",
        department_id="dept-1",
        ro_user_id="ro-user-1",
    )
    db.add(cost_center)
    
    # Create resource
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

    # RO user should see approval in inbox
    ro_headers = {"X-Dev-Role": "RO", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "ro-oid"}
    
    response = client.get("/approvals/inbox", headers=ro_headers)
    assert response.status_code == 200
    inbox = response.json()
    assert len(inbox) == 1
    approval_id = inbox[0]["id"]
    assert inbox[0]["status"] == "pending"
    ro_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "RO")
    director_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "Director")
    
    # RO approves step 1
    response = client.post(
        f"/approvals/{approval_id}/steps/{ro_step['id']}/approve",
        json={"comment": "Looks good"},
        headers=ro_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "pending"  # Still pending (Director step remains)
    
    # Director approves step 2
    director_headers = {"X-Dev-Role": "Director", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "director-oid"}
    
    response = client.post(
        f"/approvals/{approval_id}/steps/{director_step['id']}/approve",
        json={"comment": "Approved by Director"},
        headers=director_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "approved"  # Now fully approved


def test_skip_director_when_ro_equals_director(client, db):
    """Test that Director step is skipped when RO is also the Director."""
    from api.app.models.core import User, Department, CostCenter, Resource, Period, Project
    
    tenant_id = "test-tenant"
    
    # Create department
    dept = Department(
        id="dept-2",
        tenant_id=tenant_id,
        name="Test Dept 2",
        code="TD2",
    )
    db.add(dept)
    
    # Create user who is both RO and Director
    ro_director_user = User(
        id="ro-director-user",
        tenant_id=tenant_id,
        object_id="ro-director-oid",
        email="ro-director@test.com",
        display_name="RO Director User",
        role="Director",  # Has Director role
        department_id="dept-2",
    )
    db.add(ro_director_user)
    
    # Create cost center where RO = Director
    cost_center = CostCenter(
        id="cc-2",
        tenant_id=tenant_id,
        name="Test CC 2",
        code="TCC2",
        department_id="dept-2",
        ro_user_id="ro-director-user",
    )
    db.add(cost_center)

    # Create resource
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

    # When RO approves, the whole instance should be approved (Director skipped)
    headers = {"X-Dev-Role": "Director", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "ro-director-oid"}
    
    inbox_resp = client.get("/approvals/inbox", headers=headers)
    assert inbox_resp.status_code == 200
    inbox = inbox_resp.json()
    assert len(inbox) == 1
    approval_id = inbox[0]["id"]
    ro_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "RO")
    director_step = next(step for step in inbox[0]["steps"] if step["step_name"] == "Director")
    assert director_step["status"] == "skipped"

    response = client.post(
        f"/approvals/{approval_id}/steps/{ro_step['id']}/approve",
        json={"comment": "RO+Director approval"},
        headers=headers,
    )
    assert response.status_code == 200
    result = response.json()
    
    # Should be fully approved since Director step was skipped
    assert result["status"] == "approved"
    
    # Verify steps
    steps = {s["step_name"]: s["status"] for s in result["steps"]}
    assert steps["RO"] == "approved"
    assert steps["Director"] == "skipped"


def test_rejection_sets_instance_rejected(client, db):
    """Test that rejection sets the instance status to rejected."""
    from api.app.models.core import User, Department
    from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
    
    tenant_id = "test-tenant"
    
    # Create department and RO user
    dept = Department(
        id="dept-3",
        tenant_id=tenant_id,
        name="Test Dept 3",
        code="TD3",
    )
    db.add(dept)
    
    ro_user = User(
        id="ro-user-3",
        tenant_id=tenant_id,
        object_id="ro-oid-3",
        email="ro3@test.com",
        display_name="RO User 3",
        role="RO",
        department_id="dept-3",
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
    
    # RO step
    ro_step = ApprovalStep(
        id="step-5",
        instance_id="approval-3",
        step_order=1,
        step_name="RO",
        approver_id="ro-user-3",
        status=StepStatus.PENDING,
    )
    db.add(ro_step)
    
    db.commit()
    
    # RO rejects
    headers = {"X-Dev-Role": "RO", "X-Dev-Tenant": tenant_id, "X-Dev-User-Id": "ro-oid-3"}
    
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
        step_name="RO",
        status=StepStatus.APPROVED,  # Already approved
    )
    db.add(step)
    db.commit()
    
    headers = {"X-Dev-Role": "RO", "X-Dev-Tenant": tenant_id}
    
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
