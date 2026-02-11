"""Tests for admin CRUD endpoints."""


# ============== ROLE GUARDS ==============

def test_admin_can_create_department(client, admin_headers, db):
    """Admin can create a department."""
    response = client.post(
        "/admin/departments",
        json={"code": "IT", "name": "Information Technology"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["code"] == "IT"


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


def test_finance_can_read_departments(client, admin_headers, finance_headers, db):
    """Finance can read departments."""
    # Create as admin
    client.post(
        "/admin/departments",
        json={"code": "HR", "name": "Human Resources"},
        headers=admin_headers,
    )
    
    # Read as finance
    response = client.get("/admin/departments", headers=finance_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_employee_cannot_read_departments(client, employee_headers, db):
    """Employee cannot access admin endpoints."""
    response = client.get("/admin/departments", headers=employee_headers)
    assert response.status_code == 403


# ============== TENANT ISOLATION ==============

def test_departments_are_tenant_isolated(client, admin_headers, db):
    """Departments are isolated by tenant."""
    # Create in tenant 1
    client.post(
        "/admin/departments",
        json={"code": "SALES", "name": "Sales"},
        headers=admin_headers,
    )
    
    # Query from different tenant
    other_tenant_headers = {
        "X-Dev-Role": "Admin",
        "X-Dev-Tenant": "other-tenant-999",
        "X-Dev-User-Id": "admin-other",
        "X-Dev-Email": "admin@other.com",
        "X-Dev-Name": "Other Admin",
    }
    response = client.get("/admin/departments", headers=other_tenant_headers)
    assert response.status_code == 200
    
    # Should not see tenant 1's department
    codes = [d["code"] for d in response.json()]
    assert "SALES" not in codes


# ============== CRUD OPERATIONS ==============

def test_crud_department(client, admin_headers, db):
    """Test full CRUD cycle for departments."""
    # Create
    create_resp = client.post(
        "/admin/departments",
        json={"code": "ENG", "name": "Engineering"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    dept_id = create_resp.json()["id"]
    
    # Read
    get_resp = client.get(f"/admin/departments/{dept_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Engineering"
    
    # Update
    update_resp = client.patch(
        f"/admin/departments/{dept_id}",
        json={"name": "Software Engineering"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Software Engineering"
    
    # Delete (soft)
    delete_resp = client.delete(f"/admin/departments/{dept_id}", headers=admin_headers)
    assert delete_resp.status_code == 200
    
    # Verify soft deleted
    get_deleted = client.get(f"/admin/departments/{dept_id}", headers=admin_headers)
    assert get_deleted.json()["is_active"] == False


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
    # Create a department and cost center first
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "DEV", "name": "Development"},
        headers=admin_headers,
    )
    dept_id = dept_resp.json()["id"]
    
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "CC-DEV", "name": "Dev Team"},
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
    # Create department and cost center
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "OPS", "name": "Operations"},
        headers=admin_headers,
    )
    dept_id = dept_resp.json()["id"]
    
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "CC-OPS", "name": "Ops Team"},
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
            "is_external": True,
        },
        headers=admin_headers,
    )
    assert ext_resp.status_code == 200
    assert ext_resp.json()["is_oop"] == True  # External is OoP


def test_crud_placeholder(client, admin_headers, db):
    """Test CRUD for placeholders with department_id."""
    # Create a department first (required for placeholder)
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "PH-DEPT", "name": "Placeholder Dept"},
        headers=admin_headers,
    )
    dept_id = dept_resp.json()["id"]

    # Create
    create_resp = client.post(
        "/admin/placeholders",
        json={
            "name": "Senior Developer TBH",
            "skill_profile": "Full-Stack Senior",
            "department_id": dept_id,
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    placeholder_id = create_resp.json()["id"]
    assert create_resp.json()["department_id"] == dept_id
    assert create_resp.json()["department_name"] == "Placeholder Dept"
    
    # List
    list_resp = client.get("/admin/placeholders", headers=admin_headers)
    assert len(list_resp.json()) >= 1


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


def test_finance_can_create_department(client, finance_headers, db):
    """Finance can create departments (write access)."""
    response = client.post(
        "/admin/departments",
        json={"code": "FIN", "name": "Finance"},
        headers=finance_headers,
    )
    assert response.status_code == 200
    assert response.json()["code"] == "FIN"


def test_finance_can_update_and_delete_department(client, finance_headers, db):
    """Finance can update and delete departments."""
    # Create
    create_resp = client.post(
        "/admin/departments",
        json={"code": "FIN2", "name": "Finance2"},
        headers=finance_headers,
    )
    dept_id = create_resp.json()["id"]
    # Update
    update_resp = client.patch(
        f"/admin/departments/{dept_id}",
        json={"name": "Finance Updated"},
        headers=finance_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Finance Updated"
    # Delete
    delete_resp = client.delete(f"/admin/departments/{dept_id}", headers=finance_headers)
    assert delete_resp.status_code == 200


def test_finance_can_crud_cost_center(client, finance_headers, db):
    """Finance can create, update, delete cost centers."""
    # Create department first
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "FCCD", "name": "CC Dept"},
        headers=finance_headers,
    )
    dept_id = dept_resp.json()["id"]
    # Create cost center
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "FCC", "name": "Finance CC"},
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
    # Create department and cost center
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "FRES", "name": "Res Dept"},
        headers=finance_headers,
    )
    dept_id = dept_resp.json()["id"]
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "FRESCC", "name": "Res CC"},
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
    # Create a department first
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "FIN-PH", "name": "Finance PH Dept"},
        headers=admin_headers,
    )
    dept_id = dept_resp.json()["id"]

    # Create
    create_resp = client.post(
        "/admin/placeholders",
        json={"name": "Finance Placeholder", "skill_profile": "Skill", "department_id": dept_id},
        headers=finance_headers,
    )
    ph_id = create_resp.json()["id"]
    assert create_resp.status_code == 200
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


def test_pm_cannot_create_department(client, pm_headers, db):
    """PM cannot create departments (still forbidden)."""
    response = client.post(
        "/admin/departments",
        json={"code": "PMD", "name": "PM Dept"},
        headers=pm_headers,
    )
    assert response.status_code == 403


def test_ro_cannot_create_department(client, ro_headers, db):
    """RO cannot create departments (still forbidden)."""
    response = client.post(
        "/admin/departments",
        json={"code": "ROD", "name": "RO Dept"},
        headers=ro_headers,
    )
    assert response.status_code == 403


def test_employee_cannot_create_department(client, employee_headers, db):
    """Employee cannot create departments (still forbidden)."""
    response = client.post(
        "/admin/departments",
        json={"code": "EMPD", "name": "Emp Dept"},
        headers=employee_headers,
    )
    assert response.status_code == 403
