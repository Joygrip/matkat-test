"""Tests for planning endpoints - Demand and Supply lines."""
import pytest
from datetime import datetime
from dateutil.relativedelta import relativedelta

from api.app.models.core import CostCenter, User, UserRole


# ============== FIXTURES ==============

@pytest.fixture
def setup_planning_data(client, admin_headers, finance_headers, db):
    """Set up test data for planning tests."""
    # Create Manager DB row (ro-001) so supply-line scope check passes
    ro_user = User(
        tenant_id="test-tenant-001",
        object_id="ro-001",
        email="ro@test.com",
        display_name="Manager User",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(ro_user)
    db.commit()
    db.refresh(ro_user)

    cc_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-TEST", "name": "Test Cost Center"},
        headers=admin_headers,
    )
    cc_id = cc_resp.json()["id"]

    # Assign manager as ro_user_id of the cost center
    cc = db.query(CostCenter).filter(CostCenter.id == cc_id).first()
    cc.ro_user_id = ro_user.id
    db.commit()

    project_resp = client.post(
        "/admin/projects",
        json={"code": "PRJ-TEST", "name": "Test Project"},
        headers=admin_headers,
    )
    project_id = project_resp.json()["id"]

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

    # Cost center creation auto-creates one placeholder; fetch it instead of creating a duplicate.
    placeholders = client.get("/admin/placeholders", headers=admin_headers).json()
    placeholder_id = next(p["id"] for p in placeholders if p["cost_center_id"] == cc_id)
    
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
        "cost_center_id": cc_id,
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


def test_placeholder_allowed_in_current_month(client, pm_headers, setup_planning_data):
    """Placeholders are allowed in any open period (the 4MFC rule was removed)."""
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
    assert response.status_code == 200
    assert response.json()["placeholder_id"] == data["placeholder_id"]


def test_placeholder_allowed_in_future_month(client, pm_headers, setup_planning_data):
    """Placeholders are allowed in future open periods."""
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


def test_placeholder_blocked_in_locked_period(client, pm_headers, finance_headers, setup_planning_data):
    """Removing the 4MFC rule must not allow placeholder demand in locked periods."""
    data = setup_planning_data
    periods = client.get("/periods", headers=finance_headers).json()
    current = next(
        p for p in periods
        if p["year"] == data["current_year"] and p["month"] == data["current_month"]
    )
    lock = client.post(f"/periods/{current['id']}/lock", headers=finance_headers)
    assert lock.status_code == 200

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
    assert response.status_code == 403
    assert response.json()["code"] == "PERIOD_LOCKED"


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


def test_supply_over_100_percent_rejected(client, admin_headers, ro_headers, setup_planning_data):
    """Total supply for a resource/month cannot exceed 100% — SQL aggregate enforced."""
    data = setup_planning_data

    # Create a second project so we can have two distinct supply lines for the same resource/month.
    prj2 = client.post(
        "/admin/projects",
        json={"code": "PRJ-TEST2", "name": "Test Project 2"},
        headers=admin_headers,
    )
    project2_id = prj2.json()["id"]

    # First supply line on project 1: 60%
    r1 = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "project_id": data["project_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 60,
        },
        headers=ro_headers,
    )
    assert r1.status_code == 200

    # Second supply line on project 2: 50% (total would be 110%) — must be rejected
    r2 = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "project_id": project2_id,
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 50,
        },
        headers=ro_headers,
    )
    assert r2.status_code == 400
    assert r2.json()["code"] == "SUPPLY_OVER_100"

    # Second supply line on project 2: 40% (total would be 100%) — must be accepted
    r3 = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "project_id": project2_id,
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 40,
        },
        headers=ro_headers,
    )
    assert r3.status_code == 200


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


def test_finance_can_create_demand(client, finance_headers, setup_planning_data):
    """Finance can create demand lines."""
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
    assert response.status_code == 200
    assert response.json()["fte_percent"] == 50


def test_finance_can_create_supply(client, finance_headers, setup_planning_data):
    """Finance can create supply lines."""
    data = setup_planning_data
    response = client.post(
        "/supply-lines",
        json={
            "resource_id": data["resource_id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 100,
        },
        headers=finance_headers,
    )
    assert response.status_code == 200
    assert response.json()["fte_percent"] == 100


def test_finance_demand_still_enforces_xor(client, finance_headers, setup_planning_data):
    """Finance demand creation still enforces XOR rule."""
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
        headers=finance_headers,
    )
    assert response.status_code == 400


def test_finance_demand_still_enforces_period_lock(client, finance_headers, setup_planning_data):
    """Finance demand creation still blocked by locked periods."""
    data = setup_planning_data

    # Lock the current period
    periods_resp = client.get("/periods", headers=finance_headers)
    period = next(
        (p for p in periods_resp.json()
         if p["year"] == data["current_year"] and p["month"] == data["current_month"]),
        None
    )
    assert period is not None
    client.post(f"/periods/{period['id']}/lock", headers=finance_headers)

    # Try to create demand in locked period
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
    assert response.json()["code"] == "PERIOD_LOCKED"


def test_employee_cannot_create_demand(client, employee_headers, setup_planning_data):
    """Employee cannot create demand lines."""
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
        headers=employee_headers,
    )
    assert response.status_code == 403


# ============== PLACEHOLDER CREATION (PLANNING) ==============

@pytest.fixture
def manager_pm_headers():
    """Headers for Manager+PM user (Manager with secondary_role=PM)."""
    return {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "manager-pm-001",
        "X-Dev-Email": "manager.pm@test.com",
        "X-Dev-Name": "Manager PM User",
    }


def test_pm_can_create_placeholder(client, pm_headers, setup_planning_data):
    """PM can create a placeholder for a cost center; creator is recorded."""
    data = setup_planning_data
    response = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Senior Engineer"},
        headers=pm_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["name"] == "TBD Senior Engineer"
    assert result["cost_center_id"] == data["cost_center_id"]
    assert result["created_by"] is not None
    assert result["is_active"] is True

    # Visible in the lookups list used by the planning UI
    listed = client.get(
        f"/lookups/placeholders?cost_center_id={data['cost_center_id']}",
        headers=pm_headers,
    ).json()
    assert any(p["id"] == result["id"] for p in listed)


def test_multiple_placeholders_per_cost_center(client, pm_headers, setup_planning_data):
    """A cost center can hold several placeholders (one-per-CC limit removed)."""
    data = setup_planning_data
    first = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Tester"},
        headers=pm_headers,
    )
    second = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Developer"},
        headers=pm_headers,
    )
    assert first.status_code == 200
    assert second.status_code == 200
    listed = client.get(
        f"/lookups/placeholders?cost_center_id={data['cost_center_id']}",
        headers=pm_headers,
    ).json()
    # auto-created default + the two new ones
    assert len(listed) == 3


def test_duplicate_placeholder_name_rejected(client, pm_headers, setup_planning_data):
    """Duplicate active placeholder name (case-insensitive) in the same CC is rejected."""
    data = setup_planning_data
    first = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Engineer"},
        headers=pm_headers,
    )
    assert first.status_code == 200
    duplicate = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "tbd engineer"},
        headers=pm_headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "PLACEHOLDER_EXISTS"


def test_manager_pm_can_create_placeholder(client, manager_pm_headers, setup_planning_data):
    """Manager+PM (secondary role) can create placeholders."""
    data = setup_planning_data
    response = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD DSP Specialist"},
        headers=manager_pm_headers,
    )
    assert response.status_code == 200
    assert response.json()["created_by"] is not None


def test_manager_cannot_create_placeholder(client, ro_headers, setup_planning_data):
    """Plain Manager cannot create placeholders via the planning endpoint."""
    data = setup_planning_data
    response = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Blocked"},
        headers=ro_headers,
    )
    assert response.status_code == 403


def test_employee_cannot_create_placeholder(client, employee_headers, setup_planning_data):
    """Employee cannot create placeholders."""
    data = setup_planning_data
    response = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Blocked"},
        headers=employee_headers,
    )
    assert response.status_code == 403


def test_create_placeholder_unknown_cost_center(client, pm_headers, setup_planning_data):
    """Unknown or cross-tenant cost center yields 404."""
    response = client.post(
        "/placeholders",
        json={"cost_center_id": "no-such-cc", "name": "TBD Nowhere"},
        headers=pm_headers,
    )
    assert response.status_code == 404


def test_created_placeholder_usable_in_demand(client, pm_headers, setup_planning_data):
    """A PM-created placeholder can immediately carry demand in an open period."""
    data = setup_planning_data
    ph = client.post(
        "/placeholders",
        json={"cost_center_id": data["cost_center_id"], "name": "TBD Usable"},
        headers=pm_headers,
    ).json()
    response = client.post(
        "/demand-lines",
        json={
            "project_id": data["project_id"],
            "placeholder_id": ph["id"],
            "year": data["current_year"],
            "month": data["current_month"],
            "fte_percent": 25,
        },
        headers=pm_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["placeholder_id"] == ph["id"]
    assert result["cost_center_id"] == data["cost_center_id"]
