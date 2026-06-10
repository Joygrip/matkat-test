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
    assert data["cost_centers"] == []
    assert data["over_allocations"] == []
    assert data["summary"]["total_cost_centers"] == 0
    assert data["summary"]["total_demand_fte"] == 0
    assert data["summary"]["total_supply_fte"] == 0


def test_dashboard_shows_gaps(client, db):
    """Test that dashboard calculates demand/supply gaps."""
    from api.app.models.core import Period, Resource, CostCenter, Project
    from api.app.models.planning import DemandLine, SupplyLine

    tenant_id = "test-tenant"

    cc = CostCenter(
        id="cc-1", tenant_id=tenant_id, name="Test CC", code="TCC",
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
    
    assert len(data["cost_centers"]) >= 1
    cc_data = data["cost_centers"][0]
    assert cc_data["cost_center_name"] == "Test CC"
    assert len(cc_data["resources"]) >= 1
    res = cc_data["resources"][0]
    assert res["resource_id"] == "res-1"
    assert res["demand_fte"] == 80
    assert res["supply_fte"] == 60
    assert res["gap_fte"] == -20
    assert res["status"] == "under"


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
    from api.app.models.core import Period, Resource, CostCenter, Project
    from api.app.models.planning import DemandLine, SupplyLine

    tenant_id = "test-tenant"

    cc = CostCenter(
        id="cc-2", tenant_id=tenant_id, name="Test CC 2", code="TCC2",
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
    from api.app.models.core import Period, Resource, CostCenter, Project
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant"

    cc = CostCenter(
        id="cc-3", tenant_id=tenant_id, name="Test CC 3", code="TCC3",
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


# ── CSV download tests ─────────────────────────────────────────────────────────

def test_download_snapshot_csv_finance_user_can_download(client, db):
    """Finance user can download a snapshot as CSV with correct headers."""
    from api.app.models.core import Period
    from api.app.models.consolidation import PublishSnapshot, PublishSnapshotLine
    from datetime import datetime

    tenant_id = "test-tenant"

    period = Period(id="period-csv1", tenant_id=tenant_id, year=2026, month=7, status="open")
    db.add(period)

    snapshot = PublishSnapshot(
        id="snap-csv1",
        tenant_id=tenant_id,
        period_id="period-csv1",
        name="July 2026",
        published_by="finance-001",
        published_at=datetime(2026, 7, 1, 12, 0, 0),
    )
    db.add(snapshot)
    db.commit()

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    response = client.get("/consolidation/snapshots/snap-csv1/csv", headers=headers)

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert 'attachment' in response.headers["content-disposition"]
    assert "snap-csv1" in response.headers["content-disposition"]


def test_download_snapshot_csv_unauthorized_role(client, db):
    """Non-Finance roles get 403 when downloading CSV."""
    from api.app.models.core import Period
    from api.app.models.consolidation import PublishSnapshot
    from datetime import datetime

    tenant_id = "test-tenant"

    period = Period(id="period-csv2", tenant_id=tenant_id, year=2026, month=8, status="open")
    db.add(period)

    snapshot = PublishSnapshot(
        id="snap-csv2",
        tenant_id=tenant_id,
        period_id="period-csv2",
        name="August 2026",
        published_by="finance-001",
        published_at=datetime.utcnow(),
    )
    db.add(snapshot)
    db.commit()

    for role in ("Employee", "PM", "Manager"):
        headers = {"X-Dev-Role": role, "X-Dev-Tenant": tenant_id}
        response = client.get("/consolidation/snapshots/snap-csv2/csv", headers=headers)
        assert response.status_code == 403, f"Expected 403 for role {role}"


def test_download_snapshot_csv_missing_snapshot(client):
    """Returns 404 for a non-existent snapshot."""
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    response = client.get("/consolidation/snapshots/does-not-exist/csv", headers=headers)
    assert response.status_code == 404


def test_download_snapshot_csv_has_header_row(client, db):
    """CSV response contains the expected header row."""
    from api.app.models.core import Period
    from api.app.models.consolidation import PublishSnapshot
    from datetime import datetime

    tenant_id = "test-tenant"

    period = Period(id="period-csv3", tenant_id=tenant_id, year=2026, month=9, status="open")
    db.add(period)

    snapshot = PublishSnapshot(
        id="snap-csv3",
        tenant_id=tenant_id,
        period_id="period-csv3",
        name="September 2026",
        published_by="finance-001",
        published_at=datetime.utcnow(),
    )
    db.add(snapshot)
    db.commit()

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    response = client.get("/consolidation/snapshots/snap-csv3/csv", headers=headers)
    assert response.status_code == 200

    lines = response.text.strip().splitlines()
    assert len(lines) >= 1
    header = lines[0]
    for col in ("period", "line_type", "project_name", "resource_name", "fte_percent", "snapshot_name", "published_at"):
        assert col in header, f"Expected column '{col}' in header: {header}"


def test_download_snapshot_csv_has_expected_rows(client, db):
    """CSV body contains one row per snapshot line with correct values."""
    from api.app.models.core import Period
    from api.app.models.consolidation import PublishSnapshot, PublishSnapshotLine
    from datetime import datetime

    tenant_id = "test-tenant"

    period = Period(id="period-csv4", tenant_id=tenant_id, year=2026, month=10, status="open")
    db.add(period)

    snapshot = PublishSnapshot(
        id="snap-csv4",
        tenant_id=tenant_id,
        period_id="period-csv4",
        name="October 2026",
        published_by="finance-001",
        published_at=datetime(2026, 10, 1),
    )
    db.add(snapshot)

    line1 = PublishSnapshotLine(
        id="line-csv1",
        snapshot_id="snap-csv4",
        line_type="demand",
        project_id="proj-x",
        project_name="Project X",
        resource_id="res-x",
        resource_name="Alice",
        year=2026,
        month=10,
        fte_percent=75,
    )
    line2 = PublishSnapshotLine(
        id="line-csv2",
        snapshot_id="snap-csv4",
        line_type="supply",
        resource_id="res-x",
        resource_name="Alice",
        year=2026,
        month=10,
        fte_percent=100,
    )
    db.add(line1)
    db.add(line2)
    db.commit()

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    response = client.get("/consolidation/snapshots/snap-csv4/csv", headers=headers)
    assert response.status_code == 200

    lines = response.text.strip().splitlines()
    # 1 header + 2 data rows
    assert len(lines) == 3

    # Check demand row values
    assert "demand" in lines[1]
    assert "Project X" in lines[1]
    assert "Alice" in lines[1]
    assert "2026-10" in lines[1]
    assert "75" in lines[1]

    # Check supply row
    assert "supply" in lines[2]
    assert "100" in lines[2]


# ── Manager+PM dashboard scope tests ──────────────────────────────────────────

def _setup_manager_pm_fixture(db, tenant_id: str):
    """
    Shared fixture data for Manager+PM scope tests.

    Topology:
      manager-pm-user  (role=Manager, secondary_role=PM)
        ↳ ro_user_id of cc-mpm-managed (Managed CC)

      cc-mpm-other  (Other CC — not managed by this user)

      res-mpm-a  in cc-mpm-managed
      res-mpm-b  in cc-mpm-other

      project-mpm-alpha  has demand for both resources (spans both CCs)

    This lets tests verify that scope=pm returns both CCs while scope=default
    (Manager tab) returns only cc-mpm-managed.
    """
    from api.app.models.core import User, CostCenter, Resource, Project, UserRole
    from api.app.models.planning import DemandLine, SupplyLine

    # Create the Manager+PM user directly so we get their DB id for the CC link
    manager_pm_user = User(
        tenant_id=tenant_id,
        object_id="mpm-obj-001",
        email="mpm@test.com",
        display_name="Manager PM User",
        role=UserRole.MANAGER,
        secondary_role=UserRole.PM.value,
        is_active=True,
    )
    db.add(manager_pm_user)
    db.flush()  # populate manager_pm_user.id

    cc_managed = CostCenter(
        id="cc-mpm-managed",
        tenant_id=tenant_id,
        name="Managed CC",
        code="MAN",
        ro_user_id=manager_pm_user.id,
    )
    cc_other = CostCenter(
        id="cc-mpm-other",
        tenant_id=tenant_id,
        name="Other CC",
        code="OTH",
    )
    db.add(cc_managed)
    db.add(cc_other)

    res_a = Resource(
        id="res-mpm-a",
        tenant_id=tenant_id,
        display_name="Resource A",
        cost_center_id="cc-mpm-managed",
        employee_id="EMP-MPA",
    )
    res_b = Resource(
        id="res-mpm-b",
        tenant_id=tenant_id,
        display_name="Resource B",
        cost_center_id="cc-mpm-other",
        employee_id="EMP-MPB",
    )
    db.add(res_a)
    db.add(res_b)

    project = Project(
        id="proj-mpm-alpha",
        tenant_id=tenant_id,
        name="Alpha",
        code="ALP",
    )
    db.add(project)

    from api.app.models.core import Period
    period = Period(
        id="period-mpm-1",
        tenant_id=tenant_id,
        year=2026,
        month=7,
        status="open",
    )
    db.add(period)

    # Demand for both resources under the same PM project
    db.add(DemandLine(
        id="dl-mpm-a",
        tenant_id=tenant_id,
        period_id="period-mpm-1",
        project_id="proj-mpm-alpha",
        resource_id="res-mpm-a",
        year=2026, month=7, fte_percent=80, created_by="mpm-obj-001",
    ))
    db.add(DemandLine(
        id="dl-mpm-b",
        tenant_id=tenant_id,
        period_id="period-mpm-1",
        project_id="proj-mpm-alpha",
        resource_id="res-mpm-b",
        year=2026, month=7, fte_percent=60, created_by="mpm-obj-001",
    ))
    db.commit()

    return manager_pm_user


def test_plain_manager_default_scope_sees_only_managed_cc(client, db):
    """Plain Manager (no secondary_role) with default scope sees only their managed CC."""
    from api.app.models.core import User, CostCenter, Resource, Project, Period, UserRole
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant"

    plain_manager = User(
        tenant_id=tenant_id,
        object_id="pm-plain-obj-001",
        email="plain-manager@test.com",
        display_name="Plain Manager",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(plain_manager)
    db.flush()

    cc_mine = CostCenter(id="cc-plain-mine", tenant_id=tenant_id, name="My CC", code="MCM", ro_user_id=plain_manager.id)
    cc_theirs = CostCenter(id="cc-plain-other", tenant_id=tenant_id, name="Their CC", code="TCM")
    db.add(cc_mine)
    db.add(cc_theirs)

    db.add(Resource(id="res-plain-a", tenant_id=tenant_id, display_name="Alice", cost_center_id="cc-plain-mine", employee_id="EP-A"))
    db.add(Resource(id="res-plain-b", tenant_id=tenant_id, display_name="Bob", cost_center_id="cc-plain-other", employee_id="EP-B"))
    db.add(Project(id="proj-plain-1", tenant_id=tenant_id, name="Proj1", code="PP1"))
    db.add(Period(id="period-plain-1", tenant_id=tenant_id, year=2026, month=7, status="open"))
    db.add(DemandLine(id="dl-plain-a", tenant_id=tenant_id, period_id="period-plain-1", project_id="proj-plain-1", resource_id="res-plain-a", year=2026, month=7, fte_percent=50, created_by="pm-plain-obj-001"))
    db.add(DemandLine(id="dl-plain-b", tenant_id=tenant_id, period_id="period-plain-1", project_id="proj-plain-1", resource_id="res-plain-b", year=2026, month=7, fte_percent=50, created_by="pm-plain-obj-001"))
    db.commit()

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "pm-plain-obj-001",
    }
    response = client.get("/consolidation/dashboard/period-plain-1", headers=headers)
    assert response.status_code == 200
    cc_names = [cc["cost_center_name"] for cc in response.json()["cost_centers"]]
    assert "My CC" in cc_names
    assert "Their CC" not in cc_names


def test_plain_manager_scope_pm_still_sees_only_managed_cc(client, db):
    """Plain Manager requesting scope=pm still gets Manager-scoped data (no bypass)."""
    from api.app.models.core import User, CostCenter, Resource, Project, Period, UserRole
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant"

    plain_manager = User(
        tenant_id=tenant_id,
        object_id="pm-plain-obj-002",
        email="plain-manager2@test.com",
        display_name="Plain Manager 2",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(plain_manager)
    db.flush()

    cc_mine = CostCenter(id="cc-p2-mine", tenant_id=tenant_id, name="Mine CC", code="M2M", ro_user_id=plain_manager.id)
    cc_theirs = CostCenter(id="cc-p2-other", tenant_id=tenant_id, name="Other CC2", code="O2C")
    db.add(cc_mine)
    db.add(cc_theirs)

    db.add(Resource(id="res-p2-a", tenant_id=tenant_id, display_name="Alice2", cost_center_id="cc-p2-mine", employee_id="EP2-A"))
    db.add(Resource(id="res-p2-b", tenant_id=tenant_id, display_name="Bob2", cost_center_id="cc-p2-other", employee_id="EP2-B"))
    db.add(Project(id="proj-p2-1", tenant_id=tenant_id, name="Proj2", code="PP2"))
    db.add(Period(id="period-p2-1", tenant_id=tenant_id, year=2026, month=8, status="open"))
    db.add(DemandLine(id="dl-p2-a", tenant_id=tenant_id, period_id="period-p2-1", project_id="proj-p2-1", resource_id="res-p2-a", year=2026, month=8, fte_percent=50, created_by="pm-plain-obj-002"))
    db.add(DemandLine(id="dl-p2-b", tenant_id=tenant_id, period_id="period-p2-1", project_id="proj-p2-1", resource_id="res-p2-b", year=2026, month=8, fte_percent=50, created_by="pm-plain-obj-002"))
    db.commit()

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "pm-plain-obj-002",
    }
    # scope=pm must NOT expand a plain Manager's view
    response = client.get("/consolidation/dashboard/period-p2-1?scope=pm", headers=headers)
    assert response.status_code == 200
    cc_names = [cc["cost_center_name"] for cc in response.json()["cost_centers"]]
    assert "Mine CC" in cc_names
    assert "Other CC2" not in cc_names


def test_manager_pm_default_scope_returns_managed_cc_only(client, db):
    """Manager+PM default scope (Manager tab) returns only managed CC."""
    tenant_id = "test-tenant"
    _setup_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "mpm-obj-001",
    }
    response = client.get("/consolidation/dashboard/period-mpm-1", headers=headers)
    assert response.status_code == 200
    cc_names = [cc["cost_center_name"] for cc in response.json()["cost_centers"]]
    assert "Managed CC" in cc_names
    assert "Other CC" not in cc_names, "Manager tab must not expose cost centers outside manager scope"


def test_manager_pm_scope_pm_returns_full_org_data(client, db):
    """Manager+PM scope=pm (PM tab) returns all CCs so frontend can filter by PM project IDs."""
    tenant_id = "test-tenant"
    _setup_manager_pm_fixture(db, tenant_id)

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "PM",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "mpm-obj-001",
    }
    response = client.get("/consolidation/dashboard/period-mpm-1?scope=pm", headers=headers)
    assert response.status_code == 200
    data = response.json()
    cc_names = [cc["cost_center_name"] for cc in data["cost_centers"]]
    assert "Managed CC" in cc_names, "PM tab must include manager's own CC"
    assert "Other CC" in cc_names, "PM tab must include CCs outside manager scope that PM project touches"


def test_manager_reader_default_scope_still_sees_full_org(client, db):
    """Manager+Reader bypass is unchanged — full org data regardless of scope param."""
    from api.app.models.core import User, CostCenter, Resource, Project, Period, UserRole
    from api.app.models.planning import DemandLine

    tenant_id = "test-tenant"

    mr_user = User(
        tenant_id=tenant_id,
        object_id="mr-obj-001",
        email="mr@test.com",
        display_name="Manager Reader",
        role=UserRole.MANAGER,
        secondary_role=UserRole.READER.value,
        is_active=True,
    )
    db.add(mr_user)
    db.flush()

    cc_a = CostCenter(id="cc-mr-a", tenant_id=tenant_id, name="CC Alpha", code="CCA")
    cc_b = CostCenter(id="cc-mr-b", tenant_id=tenant_id, name="CC Beta", code="CCB")
    db.add(cc_a)
    db.add(cc_b)

    db.add(Resource(id="res-mr-a", tenant_id=tenant_id, display_name="Alice MR", cost_center_id="cc-mr-a", employee_id="MRA"))
    db.add(Resource(id="res-mr-b", tenant_id=tenant_id, display_name="Bob MR", cost_center_id="cc-mr-b", employee_id="MRB"))
    db.add(Project(id="proj-mr-1", tenant_id=tenant_id, name="MR Proj", code="MRP"))
    db.add(Period(id="period-mr-1", tenant_id=tenant_id, year=2026, month=9, status="open"))
    db.add(DemandLine(id="dl-mr-a", tenant_id=tenant_id, period_id="period-mr-1", project_id="proj-mr-1", resource_id="res-mr-a", year=2026, month=9, fte_percent=100, created_by="mr-obj-001"))
    db.add(DemandLine(id="dl-mr-b", tenant_id=tenant_id, period_id="period-mr-1", project_id="proj-mr-1", resource_id="res-mr-b", year=2026, month=9, fte_percent=100, created_by="mr-obj-001"))
    db.commit()

    headers = {
        "X-Dev-Role": "Manager",
        "X-Dev-Secondary-Role": "Reader",
        "X-Dev-Tenant": tenant_id,
        "X-Dev-User-Id": "mr-obj-001",
    }
    response = client.get("/consolidation/dashboard/period-mr-1", headers=headers)
    assert response.status_code == 200
    cc_names = [cc["cost_center_name"] for cc in response.json()["cost_centers"]]
    assert "CC Alpha" in cc_names
    assert "CC Beta" in cc_names
