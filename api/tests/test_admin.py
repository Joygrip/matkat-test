"""Tests for admin CRUD endpoints."""


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
    create_resp = client.post(
        "/admin/placeholders",
        json={"cost_center_id": cc_id, "name": "Finance Placeholder", "skill_profile": "Skill"},
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
