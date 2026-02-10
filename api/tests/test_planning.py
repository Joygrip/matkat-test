"""Tests for planning endpoints - Demand and Supply lines."""
import pytest
from datetime import datetime
from dateutil.relativedelta import relativedelta


# ============== FIXTURES ==============

@pytest.fixture
def setup_planning_data(client, admin_headers, finance_headers, db):
    """Set up test data for planning tests."""
    # Create department
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "TEST", "name": "Test Department"},
        headers=admin_headers,
    )
    dept_id = dept_resp.json()["id"]
    
    # Create cost center
    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "CC-TEST", "name": "Test Cost Center"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]
    
    # Create project
    project_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-TEST", "name": "Test Project"},
        headers=admin_headers,
    )
    project_id = project_resp.json()["id"]
    
    # Create resource
    resource_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-TEST",
            "display_name": "Test Employee",
        },
        headers=admin_headers,
    )
    resource_id = resource_resp.json()["id"]
    
    # Create placeholder
    placeholder_resp = client.post(
        "/admin/placeholders",
        json={"name": "Test Placeholder"},
        headers=admin_headers,
    )
    placeholder_id = placeholder_resp.json()["id"]
    
    # Create period for current month
    now = datetime.utcnow()
    client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )
    
    # Create period for future month (outside 4MFC)
    future = now + relativedelta(months=6)
    client.post(
        "/periods",
        json={"year": future.year, "month": future.month},
        headers=finance_headers,
    )
    
    return {
        "project_id": project_id,
        "resource_id": resource_id,
        "placeholder_id": placeholder_id,
        "current_year": now.year,
        "current_month": now.month,
        "future_year": future.year,
        "future_month": future.month,
    }


# ============== DEMAND LINE TESTS ==============

def test_create_demand_with_resource(client, pm_headers, setup_planning_data):
    """PM can create a demand line with a resource."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["fte_percent"] == 50
    assert result["resource_id"] == data["resource_id"]
    assert result["placeholder_id"] is None


def test_xor_blocks_both_ids(client, pm_headers, setup_planning_data):
    """Cannot specify both resource_id and placeholder_id."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "placeholder_id": data["placeholder_id"],
            "year": data["future_year"],
            "month": data["future_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    assert response.status_code == 400
    # Could be validation error or custom error depending on where check happens
    resp_json = response.json()
    assert "DEMAND_XOR" in str(resp_json) or "both" in str(resp_json).lower()


def test_xor_blocks_neither_id(client, pm_headers, setup_planning_data):
    """Must specify at least one of resource_id or placeholder_id."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "DEMAND_XOR"


def test_placeholder_blocked_in_4mfc(client, pm_headers, setup_planning_data):
    """Placeholders are blocked within 4MFC window."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "placeholder_id": data["placeholder_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "PLACEHOLDER_BLOCKED_4MFC"


def test_placeholder_allowed_outside_4mfc(client, pm_headers, setup_planning_data):
    """Placeholders are allowed outside 4MFC window."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "placeholder_id": data["placeholder_id"],
            "year": data["future_year"],
            "month": data["future_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    assert response.status_code == 200
    assert response.json()["placeholder_id"] == data["placeholder_id"]


def test_fte_invalid_range(client, pm_headers, setup_planning_data):
    """FTE must be between 5 and 100."""
    data = setup_planning_data
    
    # Too low
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 3,
        },
        headers=pm_headers,
    )
    assert response.status_code == 400
    # Could be pydantic validation or service validation
    resp_str = str(response.json())
    assert "FTE_INVALID" in resp_str or "fte" in resp_str.lower() or "5" in resp_str
    
    # Too high
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 150,
        },
        headers=pm_headers,
    )
    assert response.status_code == 400


def test_fte_invalid_step(client, pm_headers, setup_planning_data):
    """FTE must be in steps of 5."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 42,
        },
        headers=pm_headers,
    )
    assert response.status_code == 400


def test_locked_period_blocks_demand(client, pm_headers, finance_headers, setup_planning_data):
    """Locked period blocks demand line creation."""
    data = setup_planning_data
    
    # Get period and lock it
    periods_resp = client.get("/periods", headers=finance_headers)
    period = next(
        (p for p in periods_resp.json() 
         if p["year"] == data["current_year"] and p["month"] == data["current_month"]),
        None
    )
    assert period is not None
    
    client.post(f"/periods/{period['id']}/lock", headers=finance_headers)
    
    # Try to create demand
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "PERIOD_LOCKED"


# ============== SUPPLY LINE TESTS ==============

def test_create_supply_line(client, ro_headers, setup_planning_data):
    """RO can create a supply line."""
    data = setup_planning_data
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 100,
        },
        headers=ro_headers,
    )
    assert response.status_code == 200
    assert response.json()["fte_percent"] == 100


def test_supply_fte_validation(client, ro_headers, setup_planning_data):
    """Supply line FTE must be valid."""
    data = setup_planning_data
    
    # Invalid step
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 33,
        },
        headers=ro_headers,
    )
    assert response.status_code == 400


def test_locked_period_blocks_supply(client, ro_headers, finance_headers, setup_planning_data):
    """Locked period blocks supply line creation."""
    data = setup_planning_data
    
    # Get period and lock it
    periods_resp = client.get("/periods", headers=finance_headers)
    period = next(
        (p for p in periods_resp.json() 
         if p["year"] == data["current_year"] and p["month"] == data["current_month"]),
        None
    )
    assert period is not None
    
    client.post(f"/periods/{period['id']}/lock", headers=finance_headers)
    
    # Try to create supply
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 100,
        },
        headers=ro_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "PERIOD_LOCKED"


def test_pm_cannot_create_supply(client, pm_headers, setup_planning_data):
    """PM cannot create supply lines."""
    data = setup_planning_data
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 100,
        },
        headers=pm_headers,
    )
    assert response.status_code == 403


def test_finance_can_read_demand(client, finance_headers, pm_headers, setup_planning_data):
    """Finance can read demand lines."""
    data = setup_planning_data
    
    # Create as PM
    client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=pm_headers,
    )
    
    # Read as Finance
    response = client.get("/demand-lines", headers=finance_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_finance_cannot_create_demand(client, finance_headers, setup_planning_data):
    """Finance cannot create demand lines."""
    data = setup_planning_data
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    assert response.status_code == 403
