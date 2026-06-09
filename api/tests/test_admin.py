"""Tests for admin CRUD endpoints."""
from datetime import datetime


# ============== ROLE GUARDS ==============

def test_admin_can_create_cost_center(client, admin_headers, db):
    """Admin can create a cost center."""
    response = client.post(
        "/admin/cost-centers",
        json={"code": "CC-IT", "name": "Information Technology"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["code"] == "CC-IT"


def test_finance_can_create_project(client, finance_headers, db):
    """Finance can create projects (master data write access)."""
    response = client.post(
        "/admin/projects",
        json={"code": "FIN-PRJ", "name": "Finance Project"},
        headers=finance_headers,
    )
    assert response.status_code == 200
    assert response.json()["code"] == "FIN-PRJ"


def test_finance_can_crud_project(client, finance_headers, db):
    """Finance can create, update, and delete projects."""
    # Create
    create_resp = client.post(
        "/admin/projects",
        json={"code": "FP-001", "name": "Finance Project 1"},
        headers=finance_headers,
    )
    assert create_resp.status_code == 200
    project_id = create_resp.json()["id"]

    # Update
    update_resp = client.patch(
        f"/admin/projects/{project_id}",
        json={"name": "Updated Finance Project"},
        headers=finance_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Updated Finance Project"

    # Delete
    delete_resp = client.delete(f"/admin/projects/{project_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_finance_cannot_manage_settings(client, finance_headers, db):
    """Finance cannot create/update/delete settings (Admin-only)."""
    response = client.post(
        "/admin/settings",
        json={"key": "test_key", "value": "test_value"},
        headers=finance_headers,
    )
    assert response.status_code == 403


def test_pm_cannot_create_project(client, pm_headers, db):
    """PM cannot create projects (restricted to Admin/Finance)."""
    response = client.post(
        "/admin/projects",
        json={"code": "PM-PRJ", "name": "PM Project"},
        headers=pm_headers,
    )
    assert response.status_code == 403


def test_finance_can_read_cost_centers(client, admin_headers, finance_headers, db):
    """Finance can read cost centers."""
    client.post(
        "/admin/cost-centers",
        json={"code": "CC-HR", "name": "Human Resources"},
        headers=admin_headers,
    )
    response = client.get("/admin/cost-centers", headers=finance_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_employee_cannot_read_cost_centers(client, employee_headers, db):
    """Employee cannot access admin cost centers endpoint."""
    response = client.get("/admin/cost-centers", headers=employee_headers)
    assert response.status_code == 403


# ============== TENANT ISOLATION ==============

def test_cost_centers_are_tenant_isolated(client, admin_headers, db):
    """Cost centers are isolated by tenant."""
    client.post(
        "/admin/cost-centers",
        json={"code": "CC-SALES", "name": "Sales"},
        headers=admin_headers,
    )
    other_tenant_headers = {
        "X-Dev-Role": "Admin",
        "X-Dev-Tenant": "other-tenant-999",
        "X-Dev-User-Id": "admin-other",
        "X-Dev-Email": "admin@other.com",
        "X-Dev-Name": "Other Admin",
    }
    response = client.get("/admin/cost-centers", headers=other_tenant_headers)
    assert response.status_code == 200
    codes = [c["code"] for c in response.json()]
    assert "CC-SALES" not in codes


# ============== CRUD OPERATIONS ==============

def test_crud_cost_center(client, admin_headers, db):
    """Test full CRUD cycle for cost centers."""
    create_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-ENG", "name": "Engineering"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    cc_id = create_resp.json()["id"]
    get_resp = client.get(f"/admin/cost-centers/{cc_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Engineering"
    update_resp = client.patch(
        f"/admin/cost-centers/{cc_id}",
        json={"name": "Software Engineering"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Software Engineering"
    delete_resp = client.delete(f"/admin/cost-centers/{cc_id}", headers=admin_headers)
    assert delete_resp.status_code == 200
    get_deleted = client.get(f"/admin/cost-centers/{cc_id}", headers=admin_headers)
    assert get_deleted.json()["is_active"] is False


def test_crud_project(client, admin_headers, db):
    """Test full CRUD cycle for projects."""
    # Create
    create_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-001", "name": "Alpha Project"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    project_id = create_resp.json()["id"]
    
    # Read
    get_resp = client.get(f"/admin/projects/{project_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    
    # Update
    update_resp = client.patch(
        f"/admin/projects/{project_id}",
        json={"name": "Alpha Project v2"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    
    # Delete
    delete_resp = client.delete(f"/admin/projects/{project_id}", headers=admin_headers)
    assert delete_resp.status_code == 200


def test_crud_resource(client, admin_headers, db):
    """Test CRUD for resources."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-DEV", "name": "Dev Team"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]
    
    # Create resource
    create_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-100",
            "display_name": "John Doe",
            "email": "john@example.com",
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    resource = create_resp.json()
    assert resource["is_oop"] == False  # Regular employee


def test_oop_resource_flag(client, admin_headers, db):
    """Test OoP (Out of Pool) resource flag."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-OPS", "name": "Ops Team"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]
    
    # Create external resource
    ext_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EXT-100",
            "display_name": "External Contractor",
            "resource_type": "External",
        },
        headers=admin_headers,
    )
    assert ext_resp.status_code == 200
    assert ext_resp.json()["is_oop"] == True  # External is OoP


def test_crud_placeholder(client, admin_headers, db):
    """Test placeholders: one per cost center; create cost center auto-creates placeholder; update placeholder."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-PH", "name": "Placeholder CC"},
        headers=admin_headers,
    )
    assert cc_resp.status_code == 200
    cc_id = cc_resp.json()["id"]

    # List placeholders - should include the one auto-created for the cost center
    list_resp = client.get("/admin/placeholders", headers=admin_headers)
    assert list_resp.status_code == 200
    placeholders = [p for p in list_resp.json() if p.get("cost_center_id") == cc_id]
    assert len(placeholders) >= 1
    placeholder_id = placeholders[0]["id"]
    assert "Placeholder:" in placeholders[0]["name"]

    # Update placeholder name and skill profile
    update_resp = client.patch(
        f"/admin/placeholders/{placeholder_id}",
        json={"name": "Senior Developer TBH", "skill_profile": "Full-Stack Senior"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Senior Developer TBH"
    assert update_resp.json()["cost_center_id"] == cc_id


def test_crud_settings(client, admin_headers, db):
    """Test CRUD for settings."""
    # Create
    create_resp = client.post(
        "/admin/settings",
        json={
            "key": "notification_days",
            "value": "5",
            "description": "Days before deadline to send notifications",
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    
    # Duplicate should fail
    dup_resp = client.post(
        "/admin/settings",
        json={"key": "notification_days", "value": "10"},
        headers=admin_headers,
    )
    assert dup_resp.status_code == 409
    
    # Update by key
    update_resp = client.patch(
        "/admin/settings/notification_days",
        json={"value": "7"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["value"] == "7"
    
    # Get by key
    get_resp = client.get("/admin/settings/notification_days", headers=admin_headers)
    assert get_resp.status_code == 200


def test_finance_can_create_cost_center(client, finance_headers, db):
    """Finance can create cost centers (write access)."""
    response = client.post(
        "/admin/cost-centers",
        json={"code": "CC-FIN", "name": "Finance"},
        headers=finance_headers,
    )
    assert response.status_code == 200
    assert response.json()["code"] == "CC-FIN"


def test_finance_can_update_and_delete_cost_center(client, finance_headers, db):
    """Finance can update and delete cost centers."""
    create_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-FIN2", "name": "Finance2"},
        headers=finance_headers,
    )
    cc_id = create_resp.json()["id"]
    update_resp = client.patch(
        f"/admin/cost-centers/{cc_id}",
        json={"name": "Finance Updated"},
        headers=finance_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Finance Updated"
    delete_resp = client.delete(f"/admin/cost-centers/{cc_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_finance_can_crud_cost_center(client, finance_headers, db):
    """Finance can create, update, delete cost centers."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "FCC", "name": "Finance CC"},
        headers=finance_headers,
    )
    cc_id = cc_resp.json()["id"]
    assert cc_resp.status_code == 200
    # Update
    update_resp = client.patch(
        f"/admin/cost-centers/{cc_id}",
        json={"name": "Updated CC"},
        headers=finance_headers,
    )
    assert update_resp.status_code == 200
    # Delete
    delete_resp = client.delete(f"/admin/cost-centers/{cc_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_finance_can_crud_resource(client, finance_headers, db):
    """Finance can create, update, delete resources."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "FRESCC", "name": "Res CC"},
        headers=finance_headers,
    )
    cc_id = cc_resp.json()["id"]
    # Create resource
    res_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "FEMP-1", "display_name": "Finance Emp"},
        headers=finance_headers,
    )
    res_id = res_resp.json()["id"]
    assert res_resp.status_code == 200
    # Update
    update_resp = client.patch(
        f"/admin/resources/{res_id}",
        json={"display_name": "Updated Emp"},
        headers=finance_headers,
    )
    assert update_resp.status_code == 200
    # Delete
    delete_resp = client.delete(f"/admin/resources/{res_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_finance_can_crud_placeholder(client, finance_headers, admin_headers, db):
    """Finance can create, update, delete placeholders."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-FIN-PH", "name": "Finance PH CC"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]
    # Cost center creation auto-creates one placeholder; fetch it instead of creating a duplicate.
    placeholders = client.get("/admin/placeholders", headers=finance_headers).json()
    ph_id = next(p["id"] for p in placeholders if p["cost_center_id"] == cc_id)
    # Update
    update_resp = client.patch(
        f"/admin/placeholders/{ph_id}",
        json={"name": "Updated Placeholder"},
        headers=finance_headers,
    )
    assert update_resp.status_code == 200
    # Delete
    delete_resp = client.delete(f"/admin/placeholders/{ph_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_finance_can_crud_holiday(client, finance_headers, db):
    """Finance can create and delete holidays."""
    # Create
    create_resp = client.post(
        "/admin/holidays",
        json={"date": "2026-12-25", "name": "Finance Holiday"},
        headers=finance_headers,
    )
    holiday_id = create_resp.json()["id"]
    assert create_resp.status_code == 200
    # Delete
    delete_resp = client.delete(f"/admin/holidays/{holiday_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_pm_cannot_create_cost_center(client, pm_headers, db):
    """PM cannot create cost centers (forbidden)."""
    response = client.post(
        "/admin/cost-centers",
        json={"code": "CC-PMD", "name": "PM CC"},
        headers=pm_headers,
    )
    assert response.status_code == 403


def test_ro_cannot_create_cost_center(client, ro_headers, db):
    """RO cannot create cost centers (forbidden)."""
    response = client.post(
        "/admin/cost-centers",
        json={"code": "CC-ROD", "name": "RO CC"},
        headers=ro_headers,
    )
    assert response.status_code == 403


def test_employee_cannot_create_cost_center(client, employee_headers, db):
    """Employee cannot create cost centers (forbidden)."""
    response = client.post(
        "/admin/cost-centers",
        json={"code": "CC-EMPD", "name": "Emp CC"},
        headers=employee_headers,
    )
    assert response.status_code == 403


# ============== APPROVAL DELEGATE TESTS ==============

def _create_two_managers(db, tenant_id: str):
    """Create two manager User records for delegate CRUD tests."""
    from api.app.models.core import User
    mgr1 = User(
        id="adm-mgr-1", tenant_id=tenant_id, object_id="adm-mgr-oid-1",
        email="mgr1@adm.test", display_name="Manager One", role="Manager",
    )
    mgr2 = User(
        id="adm-mgr-2", tenant_id=tenant_id, object_id="adm-mgr-oid-2",
        email="mgr2@adm.test", display_name="Manager Two", role="Manager",
    )
    db.add(mgr1)
    db.add(mgr2)
    db.commit()
    return mgr1, mgr2


def test_admin_can_list_all_delegates(client, admin_headers, db):
    """Admin can list all approval delegates across all managers."""
    response = client.get("/admin/delegates", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_finance_can_create_delegate(client, finance_headers, db):
    """Finance user can create a delegation grant for any manager."""
    tenant_id = "test-tenant-001"
    mgr1, mgr2 = _create_two_managers(db, tenant_id)

    response = client.post(
        "/admin/delegates",
        json={"delegator_id": mgr1.id, "delegate_id": mgr2.id, "note": "Finance test"},
        headers=finance_headers,
    )
    assert response.status_code in (200, 201)
    data = response.json()
    assert data["delegator_id"] == mgr1.id
    assert data["delegate_id"] == mgr2.id
    assert data["is_active"] is True


def test_manager_can_create_own_delegate(client, db):
    """Manager can create a delegate grant where they are the delegator."""
    tenant_id = "test-tenant-001"
    from api.app.models.core import User
    # The manager's object_id must match X-Dev-User-Id
    mgr = User(
        id="self-mgr-1", tenant_id=tenant_id, object_id="adm-mgr-oid-1",
        email="selfmgr@adm.test", display_name="Self Manager", role="Manager",
    )
    other = User(
        id="self-mgr-2", tenant_id=tenant_id, object_id="adm-mgr-oid-2",
        email="other@adm.test", display_name="Other Manager", role="Manager",
    )
    db.add(mgr)
    db.add(other)
    db.commit()

    manager_headers = {
        "X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "adm-mgr-oid-1",
    }
    response = client.post(
        "/admin/delegates",
        json={"delegator_id": "self-mgr-1", "delegate_id": "self-mgr-2"},
        headers=manager_headers,
    )
    assert response.status_code in (200, 201)
    assert response.json()["delegator_id"] == "self-mgr-1"


def test_manager_cannot_create_delegate_for_other_manager(client, db):
    """Manager cannot create a delegation grant where a different manager is the delegator."""
    tenant_id = "test-tenant-001"
    from api.app.models.core import User
    mgr1 = User(
        id="other-mgr-1", tenant_id=tenant_id, object_id="other-mgr-oid-1",
        email="mgr1@other.test", display_name="Manager A", role="Manager",
    )
    mgr2 = User(
        id="other-mgr-2", tenant_id=tenant_id, object_id="other-mgr-oid-2",
        email="mgr2@other.test", display_name="Manager B", role="Manager",
    )
    db.add(mgr1)
    db.add(mgr2)
    db.commit()

    # Logged in as mgr2, trying to delegate mgr1's authority
    manager_headers = {
        "X-Dev-Role": "Manager", "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "other-mgr-oid-2",
    }
    response = client.post(
        "/admin/delegates",
        json={"delegator_id": "other-mgr-1", "delegate_id": "other-mgr-2"},
        headers=manager_headers,
    )
    assert response.status_code == 403


def test_admin_can_deactivate_delegate(client, admin_headers, db):
    """Admin can deactivate (is_active=False) a delegation grant."""
    from api.app.models.core import ApprovalDelegate
    tenant_id = "test-tenant-001"
    mgr1, mgr2 = _create_two_managers(db, tenant_id)

    grant = ApprovalDelegate(
        id="adm-grant-1", tenant_id=tenant_id,
        delegator_id=mgr1.id, delegate_id=mgr2.id,
        is_active=True, created_by="admin-oid",
    )
    db.add(grant)
    db.commit()

    response = client.patch(
        "/admin/delegates/adm-grant-1",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_admin_can_delete_delegate(client, admin_headers, db):
    """Admin can delete a delegation grant."""
    from api.app.models.core import ApprovalDelegate
    tenant_id = "test-tenant-001"
    mgr1, mgr2 = _create_two_managers(db, tenant_id)

    grant = ApprovalDelegate(
        id="adm-grant-2", tenant_id=tenant_id,
        delegator_id=mgr1.id, delegate_id=mgr2.id,
        is_active=True, created_by="admin-oid",
    )
    db.add(grant)
    db.commit()

    response = client.delete("/admin/delegates/adm-grant-2", headers=admin_headers)
    assert response.status_code in (200, 204)

    # Should be gone
    get_resp = client.get("/admin/delegates", headers=admin_headers)
    ids = [d["id"] for d in get_resp.json()]
    assert "adm-grant-2" not in ids


# ============== PROJECT HARD DELETE TESTS ==============

def _make_project_delete_setup(client, admin_headers, finance_headers, db):
    """Helper: create CC, resource, project, period. Returns dict of IDs."""
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-DEL", "name": "Delete Test CC"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]

    resource_resp = client.post(
        "/admin/resources",
        json={"cost_center_id": cc_id, "employee_id": "EMP-DEL", "display_name": "Delete Resource"},
        headers=admin_headers,
    )
    resource_id = resource_resp.json()["id"]

    project_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-DEL", "name": "Delete Me Project"},
        headers=admin_headers,
    )
    project_id = project_resp.json()["id"]

    # Second project – must not be affected by deleting the first
    other_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-OTHER", "name": "Other Project"},
        headers=admin_headers,
    )
    other_project_id = other_resp.json()["id"]

    now = datetime.utcnow()
    period_resp = client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )
    period_id = period_resp.json()["id"]

    return {
        "cc_id": cc_id,
        "resource_id": resource_id,
        "project_id": project_id,
        "other_project_id": other_project_id,
        "period_id": period_id,
        "year": now.year,
        "month": now.month,
    }


def test_delete_project_no_children(client, admin_headers, finance_headers, db):
    """Deleting a project with no child data actually removes the project row."""
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    # Project row must be gone — GET returns 404
    get_resp = client.get(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert get_resp.status_code == 404


def test_delete_project_removes_demand_lines(client, admin_headers, finance_headers, pm_headers, db):
    """Deleting a project deletes all its demand lines."""
    from api.app.models.planning import DemandLine
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    # Create a demand line directly (bypassing business rules for test speed)
    demand = DemandLine(
        tenant_id="test-tenant-001",
        period_id=s["period_id"],
        project_id=s["project_id"],
        resource_id=s["resource_id"],
        year=s["year"],
        month=s["month"],
        fte_percent=50,
        created_by="admin-001",
    )
    db.add(demand)
    db.commit()
    demand_id = demand.id

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    from api.app.models.planning import DemandLine as DL
    assert db.query(DL).filter(DL.id == demand_id).first() is None


def test_delete_project_removes_supply_lines(client, admin_headers, finance_headers, db):
    """Deleting a project deletes all its supply lines."""
    from api.app.models.planning import SupplyLine
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    supply = SupplyLine(
        tenant_id="test-tenant-001",
        period_id=s["period_id"],
        resource_id=s["resource_id"],
        project_id=s["project_id"],
        year=s["year"],
        month=s["month"],
        fte_percent=100,
        created_by="admin-001",
    )
    db.add(supply)
    db.commit()
    supply_id = supply.id

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    from api.app.models.planning import SupplyLine as SL
    assert db.query(SL).filter(SL.id == supply_id).first() is None


def test_delete_project_removes_actual_lines_and_approvals(client, admin_headers, finance_headers, db):
    """Deleting a project deletes actual lines and any approval instances/steps/actions linked to them."""
    from api.app.models.actuals import ActualLine
    from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalAction, ApprovalStatus, StepStatus
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    actual = ActualLine(
        tenant_id="test-tenant-001",
        period_id=s["period_id"],
        resource_id=s["resource_id"],
        project_id=s["project_id"],
        year=s["year"],
        month=s["month"],
        actual_fte_percent=50,
        created_by="admin-001",
    )
    db.add(actual)
    db.commit()
    actual_id = actual.id

    # Attach an approval workflow to this actual
    instance = ApprovalInstance(
        tenant_id="test-tenant-001",
        subject_type="actuals",
        subject_id=actual_id,
        status=ApprovalStatus.PENDING,
        created_by="admin-001",
    )
    db.add(instance)
    db.commit()
    instance_id = instance.id

    step = ApprovalStep(
        instance_id=instance_id,
        step_order=1,
        step_name="Manager",
        status=StepStatus.PENDING,
    )
    db.add(step)
    db.commit()
    step_id = step.id

    action = ApprovalAction(
        tenant_id="test-tenant-001",
        instance_id=instance_id,
        step_id=step_id,
        action="approve",
        performed_by="admin-001",
    )
    db.add(action)
    db.commit()
    action_id = action.id

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    assert db.query(ActualLine).filter(ActualLine.id == actual_id).first() is None
    assert db.query(ApprovalInstance).filter(ApprovalInstance.id == instance_id).first() is None
    assert db.query(ApprovalStep).filter(ApprovalStep.id == step_id).first() is None
    assert db.query(ApprovalAction).filter(ApprovalAction.id == action_id).first() is None


def test_delete_project_removes_oop_lines(client, admin_headers, finance_headers, db):
    """Deleting a project deletes all OoP lines."""
    from api.app.models.consolidation import OopLine
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    oop = OopLine(
        tenant_id="test-tenant-001",
        period_id=s["period_id"],
        resource_id=s["resource_id"],
        project_id=s["project_id"],
        year=s["year"],
        month=s["month"],
        hours=10,
        hourly_rate=500,
        total_cost=5000,
        created_by="admin-001",
    )
    db.add(oop)
    db.commit()
    oop_id = oop.id

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    assert db.query(OopLine).filter(OopLine.id == oop_id).first() is None


def test_delete_project_removes_equipment_and_external_lines(client, admin_headers, finance_headers, db):
    """Deleting a project removes ProjectEquipmentLine and ProjectExternalLine rows."""
    from api.app.models.project_costs import ProjectEquipmentLine, ProjectExternalLine
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    equip = ProjectEquipmentLine(
        tenant_id="test-tenant-001",
        project_id=s["project_id"],
        period_id=s["period_id"],
        description="Test Equipment",
        cost=10000,
        created_by="admin-001",
    )
    db.add(equip)

    ext = ProjectExternalLine(
        tenant_id="test-tenant-001",
        project_id=s["project_id"],
        period_id=s["period_id"],
        description="External Vendor",
        cost=20000,
        created_by="admin-001",
    )
    db.add(ext)
    db.commit()
    equip_id = equip.id
    ext_id = ext.id

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    assert db.query(ProjectEquipmentLine).filter(ProjectEquipmentLine.id == equip_id).first() is None
    assert db.query(ProjectExternalLine).filter(ProjectExternalLine.id == ext_id).first() is None


def test_delete_project_does_not_affect_other_project(client, admin_headers, finance_headers, db):
    """Deleting one project does not delete another project's demand lines or supply lines."""
    from api.app.models.planning import DemandLine, SupplyLine
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    other_demand = DemandLine(
        tenant_id="test-tenant-001",
        period_id=s["period_id"],
        project_id=s["other_project_id"],
        resource_id=s["resource_id"],
        year=s["year"],
        month=s["month"],
        fte_percent=50,
        created_by="admin-001",
    )
    db.add(other_demand)
    db.commit()
    other_demand_id = other_demand.id

    # Delete the first project
    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    # Other project's demand line must still exist
    assert db.query(DemandLine).filter(DemandLine.id == other_demand_id).first() is not None
    # Other project itself must still exist
    other_get = client.get(f"/admin/projects/{s['other_project_id']}", headers=admin_headers)
    assert other_get.status_code == 200


def test_pm_cannot_delete_project(client, pm_headers, admin_headers, finance_headers, db):
    """PM does not have permission to delete a project."""
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=pm_headers)
    assert resp.status_code == 403

    # Project must still exist
    get_resp = client.get(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert get_resp.status_code == 200


def test_delete_nonexistent_project_returns_404(client, admin_headers, db):
    """Deleting a project that does not exist returns 404."""
    resp = client.delete("/admin/projects/no-such-project-id", headers=admin_headers)
    assert resp.status_code == 404


def test_delete_project_not_soft_delete(client, admin_headers, finance_headers, db):
    """DELETE endpoint actually removes the project, not just marks is_active=False."""
    from api.app.models.core import Project
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    resp = client.delete(f"/admin/projects/{s['project_id']}", headers=admin_headers)
    assert resp.status_code == 200

    # The row must be completely gone from the DB
    row = db.query(Project).filter(Project.id == s["project_id"]).first()
    assert row is None, "Project row should be deleted, not soft-deleted"


def test_set_project_inactive_still_works(client, admin_headers, finance_headers, db):
    """PATCH to set is_active=False (On Hold) still works independently of DELETE."""
    s = _make_project_delete_setup(client, admin_headers, finance_headers, db)

    patch_resp = client.patch(
        f"/admin/projects/{s['project_id']}",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["is_active"] is False

    # Project still exists in the DB; it's just inactive
    from api.app.models.core import Project
    row = db.query(Project).filter(Project.id == s["project_id"]).first()
    assert row is not None
    assert row.is_active is False
