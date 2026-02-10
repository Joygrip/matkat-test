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


def test_finance_cannot_create_department(client, finance_headers, db):
    """Finance cannot create departments (read-only)."""
    response = client.post(
        "/admin/departments",
        json={"code": "IT", "name": "Information Technology"},
        headers=finance_headers,
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
    """Test CRUD for placeholders."""
    # Create
    create_resp = client.post(
        "/admin/placeholders",
        json={
            "name": "Senior Developer TBH",
            "skill_profile": "Full-Stack Senior",
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    placeholder_id = create_resp.json()["id"]
    
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
