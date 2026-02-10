"""Tests for consolidation endpoints."""
import pytest


def test_dashboard_requires_finance_or_director(client):
    """Test that dashboard requires Finance or Director role."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get("/consolidation/dashboard/period-1", headers=headers)
    assert response.status_code == 403


def test_dashboard_returns_404_for_nonexistent_period(client):
    """Test that dashboard returns 404 for non-existent period."""
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get("/consolidation/dashboard/nonexistent", headers=headers)
    assert response.status_code == 404


def test_dashboard_with_empty_period(client, db):
    """Test dashboard with a period that has no planning data."""
    from api.app.models.core import Period
    
    tenant_id = "test-tenant"
    
    # Create period
    period = Period(
        id="period-1",
        tenant_id=tenant_id,
        year=2026,
        month=2,
        status="open",
    )
    db.add(period)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.get("/consolidation/dashboard/period-1", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert data["period_id"] == "period-1"
    assert data["gaps"] == []
    assert data["orphan_demands"] == []
    assert data["over_allocations"] == []
    assert data["summary"]["total_resources"] == 0


def test_dashboard_shows_gaps(client, db):
    """Test that dashboard calculates demand/supply gaps."""
    from api.app.models.core import Period, Resource, CostCenter, Department, Project
    from api.app.models.planning import DemandLine, SupplyLine
    
    tenant_id = "test-tenant"
    
    # Create department and cost center
    dept = Department(id="dept-1", tenant_id=tenant_id, name="Test Dept", code="TD")
    db.add(dept)
    
    cc = CostCenter(
        id="cc-1", tenant_id=tenant_id, name="Test CC", code="TCC", 
        department_id="dept-1"
    )
    db.add(cc)
    
    # Create resource
    resource = Resource(
        id="res-1", tenant_id=tenant_id, display_name="Test Resource",
        cost_center_id="cc-1", employee_id="EMP001",
    )
    db.add(resource)
    
    # Create period
    period = Period(id="period-2", tenant_id=tenant_id, year=2026, month=2, status="open")
    db.add(period)
    
    # Create project
    project = Project(id="proj-1", tenant_id=tenant_id, name="Test Project", code="TP")
    db.add(project)
    
    # Create demand (80%) and supply (60%) - should show 20% gap
    demand = DemandLine(
        id="demand-1", tenant_id=tenant_id, period_id="period-2",
        project_id="proj-1", resource_id="res-1",
        year=2026, month=2, fte_percent=80, created_by="user-1",
    )
    db.add(demand)
    
    supply = SupplyLine(
        id="supply-1", tenant_id=tenant_id, period_id="period-2",
        resource_id="res-1", year=2026, month=2, fte_percent=60, created_by="user-1",
    )
    db.add(supply)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.get("/consolidation/dashboard/period-2", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["gaps"]) == 1
    gap = data["gaps"][0]
    assert gap["resource_id"] == "res-1"
    assert gap["demand_fte"] == 80
    assert gap["supply_fte"] == 60
    assert gap["gap_fte"] == -20
    assert gap["status"] == "under"


def test_publish_snapshot(client, db):
    """Test publishing a snapshot."""
    from api.app.models.core import Period
    
    tenant_id = "test-tenant"
    
    # Create period
    period = Period(id="period-3", tenant_id=tenant_id, year=2026, month=2, status="open")
    db.add(period)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.post(
        "/consolidation/publish/period-3",
        json={"name": "February 2026 Final", "description": "Final snapshot"},
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["name"] == "February 2026 Final"
    assert data["description"] == "Final snapshot"
    assert data["period_id"] == "period-3"
    assert data["lines_count"] == 0  # Empty period


def test_publish_snapshot_includes_planning_data(client, db):
    """Test that published snapshot includes demand and supply lines."""
    from api.app.models.core import Period, Resource, CostCenter, Department, Project
    from api.app.models.planning import DemandLine, SupplyLine
    
    tenant_id = "test-tenant"
    
    # Create department and cost center
    dept = Department(id="dept-2", tenant_id=tenant_id, name="Test Dept 2", code="TD2")
    db.add(dept)
    
    cc = CostCenter(
        id="cc-2", tenant_id=tenant_id, name="Test CC 2", code="TCC2", 
        department_id="dept-2"
    )
    db.add(cc)
    
    # Create resource
    resource = Resource(
        id="res-2", tenant_id=tenant_id, display_name="Test Resource 2",
        cost_center_id="cc-2", employee_id="EMP002",
    )
    db.add(resource)
    
    # Create period
    period = Period(id="period-4", tenant_id=tenant_id, year=2026, month=3, status="open")
    db.add(period)
    
    # Create project
    project = Project(id="proj-2", tenant_id=tenant_id, name="Test Project 2", code="TP2")
    db.add(project)
    
    # Create demand and supply
    demand = DemandLine(
        id="demand-2", tenant_id=tenant_id, period_id="period-4",
        project_id="proj-2", resource_id="res-2",
        year=2026, month=3, fte_percent=50, created_by="user-1",
    )
    db.add(demand)
    
    supply = SupplyLine(
        id="supply-2", tenant_id=tenant_id, period_id="period-4",
        resource_id="res-2", year=2026, month=3, fte_percent=100, created_by="user-1",
    )
    db.add(supply)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    # Publish snapshot
    response = client.post(
        "/consolidation/publish/period-4",
        json={"name": "March 2026 v1"},
        headers=headers,
    )
    assert response.status_code == 200
    snapshot_id = response.json()["id"]
    assert response.json()["lines_count"] == 2  # 1 demand + 1 supply
    
    # Get snapshot details
    response = client.get(f"/consolidation/snapshots/{snapshot_id}", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["lines"]) == 2
    
    # Verify line types
    line_types = [l["line_type"] for l in data["lines"]]
    assert "demand" in line_types
    assert "supply" in line_types


def test_snapshots_are_immutable(client, db):
    """Test that snapshot data doesn't change after publishing."""
    from api.app.models.core import Period, Resource, CostCenter, Department, Project
    from api.app.models.planning import DemandLine
    
    tenant_id = "test-tenant"
    
    # Create department and cost center
    dept = Department(id="dept-3", tenant_id=tenant_id, name="Test Dept 3", code="TD3")
    db.add(dept)
    
    cc = CostCenter(
        id="cc-3", tenant_id=tenant_id, name="Test CC 3", code="TCC3", 
        department_id="dept-3"
    )
    db.add(cc)
    
    # Create resource
    resource = Resource(
        id="res-3", tenant_id=tenant_id, display_name="Test Resource 3",
        cost_center_id="cc-3", employee_id="EMP003",
    )
    db.add(resource)
    
    # Create period
    period = Period(id="period-5", tenant_id=tenant_id, year=2026, month=4, status="open")
    db.add(period)
    
    # Create project
    project = Project(id="proj-3", tenant_id=tenant_id, name="Test Project 3", code="TP3")
    db.add(project)
    
    # Create demand
    demand = DemandLine(
        id="demand-3", tenant_id=tenant_id, period_id="period-5",
        project_id="proj-3", resource_id="res-3",
        year=2026, month=4, fte_percent=50, created_by="user-1",
    )
    db.add(demand)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    # Publish snapshot
    response = client.post(
        "/consolidation/publish/period-5",
        json={"name": "April 2026 v1"},
        headers=headers,
    )
    snapshot_id = response.json()["id"]
    
    # Update the original demand
    demand.fte_percent = 100
    db.commit()
    
    # Verify snapshot still has original value
    response = client.get(f"/consolidation/snapshots/{snapshot_id}", headers=headers)
    data = response.json()
    
    demand_line = [l for l in data["lines"] if l["line_type"] == "demand"][0]
    assert demand_line["fte_percent"] == 50  # Original value, not 100


def test_list_snapshots(client, db):
    """Test listing snapshots."""
    from api.app.models.core import Period
    from api.app.models.consolidation import PublishSnapshot
    from datetime import datetime
    
    tenant_id = "test-tenant"
    
    # Create period
    period = Period(id="period-6", tenant_id=tenant_id, year=2026, month=5, status="open")
    db.add(period)
    
    # Create snapshots
    for i in range(3):
        snapshot = PublishSnapshot(
            id=f"snapshot-{i}",
            tenant_id=tenant_id,
            period_id="period-6",
            name=f"Snapshot {i}",
            published_by="user-1",
            published_at=datetime.utcnow(),
        )
        db.add(snapshot)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.get("/consolidation/snapshots", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert len(data) == 3


def test_pm_cannot_publish(client, db):
    """Test that PM cannot publish snapshots."""
    from api.app.models.core import Period
    
    tenant_id = "test-tenant"
    
    period = Period(id="period-7", tenant_id=tenant_id, year=2026, month=6, status="open")
    db.add(period)
    db.commit()
    
    headers = {"X-Dev-Role": "PM", "X-Dev-Tenant": tenant_id}
    
    response = client.post(
        "/consolidation/publish/period-7",
        json={"name": "Unauthorized"},
        headers=headers,
    )
    assert response.status_code == 403
