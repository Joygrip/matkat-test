"""Tests for actuals endpoints."""
import pytest
from datetime import datetime

from api.app.models.core import User, UserRole


@pytest.fixture
def setup_actuals_data(client, admin_headers, finance_headers, db):
    """Set up test data for actuals tests.
    
    Creates a User record for the employee and links the Resource to it,
    ensuring employee ownership checks pass.
    """
    # Create a User record for the employee (matching employee_headers object_id)
    employee_user = User(
        tenant_id="test-tenant-001",
        object_id="employee-001",
        email="employee@test.com",
        display_name="Employee User",
        role=UserRole.EMPLOYEE,
    )
    db.add(employee_user)
    db.commit()
    db.refresh(employee_user)
    employee_user_id = employee_user.id

    # Create department
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "ACT-TEST", "name": "Actuals Test Dept"},
        headers=admin_headers,
    )
    dept_id = dept_resp.json()["id"]
    
    # Create cost center
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "CC-ACT", "name": "Actuals Test CC"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]
    
    # Create projects
    project1_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-ACT1", "name": "Actuals Project 1"},
        headers=admin_headers,
    )
    project1_id = project1_resp.json()["id"]
    
    project2_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-ACT2", "name": "Actuals Project 2"},
        headers=admin_headers,
    )
    project2_id = project2_resp.json()["id"]
    
    # Create resource linked to the employee user
    resource_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-ACT",
            "display_name": "Actuals Employee",
            "user_id": employee_user_id,
        },
        headers=admin_headers,
    )
    resource_id = resource_resp.json()["id"]

    # Create a second resource NOT linked to the employee (for ownership tests)
    other_resource_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-OTHER",
            "display_name": "Other Employee",
        },
        headers=admin_headers,
    )
    other_resource_id = other_resource_resp.json()["id"]
    
    # Create period for current month
    now = datetime.utcnow()
    client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )
    
    return {
        "project1_id": project1_id,
        "project2_id": project2_id,
        "resource_id": resource_id,
        "other_resource_id": other_resource_id,
        "year": now.year,
        "month": now.month,
    }


def test_create_actual_line(client, employee_headers, setup_actuals_data):
    """Employee can create an actual line."""
    data = setup_actuals_data
    response = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["actual_fte_percent"] == 50


def test_actuals_over_100_blocked(client, employee_headers, setup_actuals_data):
    """Total actuals cannot exceed 100%."""
    data = setup_actuals_data
    
    # Create first line with 60%
    client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 60,
        },
        headers=employee_headers,
    )
    
    # Try to create second line with 50% (would make 110%)
    response = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project2_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    assert response.status_code == 400
    result = response.json()
    assert result["code"] == "ACTUALS_OVER_100"
    assert result["total_percent"] == 110
    assert "offending_line_ids" in result


def test_actuals_exactly_100_allowed(client, employee_headers, setup_actuals_data):
    """Total actuals of exactly 100% is allowed."""
    data = setup_actuals_data
    
    # Create first line with 60%
    client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 60,
        },
        headers=employee_headers,
    )
    
    # Create second line with 40% (exactly 100%)
    response = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project2_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 40,
        },
        headers=employee_headers,
    )
    assert response.status_code == 200


def test_sign_actuals(client, employee_headers, setup_actuals_data):
    """Employee can sign their actuals."""
    data = setup_actuals_data
    
    # Create actual
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    actual_id = create_resp.json()["id"]
    
    # Sign it
    sign_resp = client.post(f"/actuals/{actual_id}/sign", headers=employee_headers)
    assert sign_resp.status_code == 200
    result = sign_resp.json()
    assert result["employee_signed_at"] is not None
    assert result["is_proxy_signed"] == False


def test_proxy_sign_requires_reason(client, ro_headers, employee_headers, setup_actuals_data):
    """Proxy sign requires a reason."""
    data = setup_actuals_data
    
    # Create actual
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    actual_id = create_resp.json()["id"]
    
    # Try to proxy sign without reason
    response = client.post(
        f"/actuals/{actual_id}/proxy-sign",
        json={"reason": ""},
        headers=ro_headers,
    )
    assert response.status_code == 400 or response.status_code == 422


def test_proxy_sign_with_reason(client, ro_headers, employee_headers, setup_actuals_data):
    """RO can proxy sign with a reason."""
    data = setup_actuals_data
    
    # Create actual
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    actual_id = create_resp.json()["id"]
    
    # Proxy sign
    response = client.post(
        f"/actuals/{actual_id}/proxy-sign",
        json={"reason": "Employee on vacation"},
        headers=ro_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["is_proxy_signed"] == True
    assert result["proxy_sign_reason"] == "Employee on vacation"


def test_cannot_edit_signed_actuals(client, employee_headers, setup_actuals_data):
    """Cannot edit signed actuals."""
    data = setup_actuals_data
    
    # Create and sign actual
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    actual_id = create_resp.json()["id"]
    client.post(f"/actuals/{actual_id}/sign", headers=employee_headers)
    
    # Try to edit
    response = client.patch(
        f"/actuals/{actual_id}",
        json={"actual_fte_percent": 60},
        headers=employee_headers,
    )
    assert response.status_code == 400
    assert "signed" in response.json()["detail"].lower()


def test_locked_period_blocks_actuals(client, employee_headers, finance_headers, setup_actuals_data):
    """Locked period blocks actuals creation."""
    data = setup_actuals_data
    
    # Get period and lock it
    periods_resp = client.get("/periods", headers=finance_headers)
    period = next(
        (p for p in periods_resp.json() 
         if p["year"] == data["year"] and p["month"] == data["month"]),
        None
    )
    assert period is not None
    client.post(f"/periods/{period['id']}/lock", headers=finance_headers)
    
    # Try to create actual
    response = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "PERIOD_LOCKED"


def test_locked_period_blocks_sign(client, employee_headers, finance_headers, setup_actuals_data):
    """Locked period blocks signing actuals."""
    data = setup_actuals_data

    # Create actual while open
    create_resp = client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    actual_id = create_resp.json()["id"]

    # Lock the period
    periods_resp = client.get("/periods", headers=finance_headers)
    period = next(
        (p for p in periods_resp.json()
         if p["year"] == data["year"] and p["month"] == data["month"]),
        None
    )
    assert period is not None
    client.post(f"/periods/{period['id']}/lock", headers=finance_headers)

    # Try to sign
    sign_resp = client.post(f"/actuals/{actual_id}/sign", headers=employee_headers)
    assert sign_resp.status_code == 403
    assert sign_resp.json()["code"] == "PERIOD_LOCKED"


def test_get_resource_monthly_total(client, employee_headers, setup_actuals_data):
    """Get total FTE for a resource in a month."""
    data = setup_actuals_data
    
    # Create some actuals
    client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 30,
        },
        headers=employee_headers,
    )
    client.post(
        "/actuals",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project2_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 25,
        },
        headers=employee_headers,
    )
    
    # Get total
    response = client.get(
        f"/actuals/resource/{data['resource_id']}/total",
        params={"year": data["year"], "month": data["month"]},
        headers=employee_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["total_percent"] == 55
    assert result["remaining_percent"] == 45


def test_employee_cannot_create_actuals_for_other_resource(client, employee_headers, setup_actuals_data):
    """Employee cannot create actuals for a resource they don't own."""
    data = setup_actuals_data
    response = client.post(
        "/actuals",
        json={
            "resource_id": data["other_resource_id"],
            "project_id": data["project1_id"],
            "year": data["year"],
            "month": data["month"],
            "actual_fte_percent": 50,
        },
        headers=employee_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "UNAUTHORIZED_RESOURCE"
