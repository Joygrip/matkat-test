"""Tests for notifications endpoints."""
import pytest
from datetime import date


def test_notifications_requires_finance(client):
    """Test that notifications endpoints require Finance role."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get(
        "/notifications/preview?phase=PM_RO&year=2026&month=2",
        headers=headers,
    )
    assert response.status_code == 403


def test_preview_notifications(client, db):
    """Test previewing notifications without sending."""
    from api.app.models.core import User
    
    tenant_id = "test-tenant"
    
    # Create a PM user
    user = User(
        id="pm-user-1",
        tenant_id=tenant_id,
        object_id="pm-oid",
        email="pm@test.com",
        display_name="PM User",
        role="PM",
        is_active=True,
    )
    db.add(user)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.get(
        "/notifications/preview?phase=PM_RO&year=2026&month=2",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["phase"] == "PM_RO"
    assert data["year"] == 2026
    assert data["month"] == 2
    assert data["recipients_count"] >= 1
    assert "deadline" in data
    assert "message_template" in data


def test_run_notifications(client, db):
    """Test running notifications (stub mode)."""
    from api.app.models.core import User
    
    tenant_id = "test-tenant"
    
    # Create an Employee user
    user = User(
        id="employee-1",
        tenant_id=tenant_id,
        object_id="employee-oid",
        email="employee@test.com",
        display_name="Employee User",
        role="Employee",
        is_active=True,
    )
    db.add(user)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.post(
        "/notifications/run?phase=Employee&year=2026&month=2",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["status"] == "success"
    assert data["phase"] == "Employee"
    assert data["notifications_count"] >= 1
    assert "run_id" in data


def test_notifications_idempotent(client, db):
    """Test that running notifications twice doesn't duplicate."""
    from api.app.models.core import User
    
    tenant_id = "test-tenant"
    
    # Create a Manager user
    user = User(
        id="director-1",
        tenant_id=tenant_id,
        object_id="director-oid",
        email="director@test.com",
        display_name="Manager User",
        role="Manager",
        is_active=True,
    )
    db.add(user)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    # First run
    response = client.post(
        "/notifications/run?phase=RO_Director&year=2026&month=3",
        headers=headers,
    )
    assert response.status_code == 200
    first_run_id = response.json()["run_id"]
    
    # Second run - should detect already run
    response = client.post(
        "/notifications/run?phase=RO_Director&year=2026&month=3",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["status"] == "already_run"
    assert data["existing_run_id"] == first_run_id


def test_deadline_calculation(client):
    """Test deadline calculation endpoint."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get(
        "/notifications/deadline?year=2026&month=2&base_day=5",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["year"] == 2026
    assert data["month"] == 2
    assert data["base_day"] == 5
    assert "deadline" in data


@pytest.mark.parametrize(
    "phase,expected",
    [
        ("PM_RO", "2026-04-03"),       # 1st Friday
        ("Finance", "2026-04-17"),     # 3rd Friday
        ("Employee", "2026-04-27"),    # 4th Monday
        ("RO_Director", "2026-04-28"), # 4th Tuesday
    ],
)
def test_phase_deadline_calculation(client, phase, expected):
    """Test phase-based deadline calculation."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}
    
    response = client.get(
        f"/notifications/deadline?year=2026&month=4&phase={phase}",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["phase"] == phase
    assert data["deadline"] == expected


def test_holiday_roll_forward(client, db):
    """Test that deadline rolls forward when it falls on a holiday."""
    from api.app.models.core import Holiday
    from datetime import date
    
    tenant_id = "test-tenant"
    
    # Create a holiday on the 5th
    holiday = Holiday(
        id="holiday-1",
        tenant_id=tenant_id,
        name="Test Holiday",
        date=date(2026, 4, 5),
    )
    db.add(holiday)
    db.commit()
    
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": tenant_id}
    
    response = client.get(
        "/notifications/deadline?year=2026&month=4&base_day=5",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    # Deadline should be rolled forward past the holiday
    deadline = date.fromisoformat(data["deadline"])
    assert deadline > date(2026, 4, 5)


def test_phase_holiday_shift(client, db):
    """Test that phase deadline shifts when it falls on a holiday."""
    from api.app.models.core import Holiday
    
    tenant_id = "test-tenant"
    
    # May 1, 2026 is a Friday (PM_RO base date); shift should move to May 4
    holiday = Holiday(
        id="holiday-2",
        tenant_id=tenant_id,
        name="Holiday on First Friday",
        date=date(2026, 5, 1),
    )
    db.add(holiday)
    db.commit()
    
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": tenant_id}
    
    response = client.get(
        "/notifications/deadline?year=2026&month=5&phase=PM_RO",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    
    assert data["deadline"] == "2026-05-04"


def test_get_notification_logs(client, db):
    """Test getting notification logs."""
    from api.app.models.notifications import NotificationLog, NotificationPhase, NotificationStatus
    from datetime import datetime
    
    tenant_id = "test-tenant"
    
    # Create some logs
    log = NotificationLog(
        id="log-1",
        tenant_id=tenant_id,
        phase=NotificationPhase.PM_RO,
        year=2026,
        month=2,
        recipient_email="pm@test.com",
        status=NotificationStatus.SENT,
        message="Test message",
        run_id="run-1",
        created_at=datetime.utcnow(),
    )
    db.add(log)
    db.commit()
    
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}
    
    response = client.get("/notifications/logs", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert len(data) >= 1
    assert data[0]["phase"] == "PM_RO"
    assert data[0]["recipient_email"] == "pm@test.com"


def test_get_logs_with_filters(client, db):
    """Test filtering notification logs."""
    from api.app.models.notifications import NotificationLog, NotificationPhase, NotificationStatus
    from datetime import datetime

    tenant_id = "test-tenant"

    # Create logs for different phases
    for phase in [NotificationPhase.PM_RO, NotificationPhase.FINANCE]:
        log = NotificationLog(
            tenant_id=tenant_id,
            phase=phase,
            year=2026,
            month=5,
            recipient_email="user@test.com",
            status=NotificationStatus.SENT,
            run_id=f"run-{phase.value}",
            created_at=datetime.utcnow(),
        )
        db.add(log)
    db.commit()

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": tenant_id}

    # Filter by phase
    response = client.get("/notifications/logs?phase=Finance", headers=headers)
    assert response.status_code == 200
    data = response.json()

    assert all(log["phase"] == "Finance" for log in data)


# ---------------------------------------------------------------------------
# Helpers for conflict / missing-actuals tests
# ---------------------------------------------------------------------------

def _seed_conflict_data(db, tenant_id: str):
    """Seed a resource with demand > supply so conflict detection fires."""
    from api.app.models.core import User, CostCenter, Project, Resource
    from api.app.models.planning import DemandLine, SupplyLine
    from api.app.models.core import Period, PeriodStatus

    ro = User(
        id="ro-conflict-1", tenant_id=tenant_id, object_id="ro-oid-c",
        email="ro@test.com", display_name="Manager User", role="Manager", is_active=True,
    )
    pm = User(
        id="pm-conflict-1", tenant_id=tenant_id, object_id="pm-oid-c",
        email="pm@test.com", display_name="PM User", role="PM", is_active=True,
    )
    db.add_all([ro, pm])
    db.flush()

    cc = CostCenter(
        id="cc-conflict-1", tenant_id=tenant_id, code="CC-C1",
        name="Conflict CC", ro_user_id=ro.id, is_active=True,
    )
    db.add(cc)
    db.flush()

    project = Project(
        id="proj-conflict-1", tenant_id=tenant_id, code="PR-C1",
        name="Conflict Project", is_active=True,
    )
    db.add(project)
    db.flush()
    from api.app.models.core import ProjectPM
    db.add(ProjectPM(project_id=project.id, user_id=pm.id, tenant_id=tenant_id))
    db.flush()

    resource = Resource(
        id="res-conflict-1", tenant_id=tenant_id, cost_center_id=cc.id,
        employee_id="EMP-C1", display_name="Conflict Resource", is_active=True,
    )
    db.add(resource)
    db.flush()

    period = Period(
        id="period-conflict-1", tenant_id=tenant_id, year=2026, month=6,
        status=PeriodStatus.OPEN,
    )
    db.add(period)
    db.flush()

    # Demand = 100%, Supply = 50% → conflict
    demand = DemandLine(
        id="demand-c1", tenant_id=tenant_id, period_id=period.id,
        project_id=project.id, resource_id=resource.id,
        year=2026, month=6, fte_percent=100, created_by=pm.id,
    )
    supply = SupplyLine(
        id="supply-c1", tenant_id=tenant_id, period_id=period.id,
        resource_id=resource.id, year=2026, month=6,
        fte_percent=50, created_by=ro.id,
    )
    db.add_all([demand, supply])
    db.commit()


def _seed_missing_actuals_data(db, tenant_id: str):
    """Seed a resource with demand but no signed actuals."""
    from api.app.models.core import User, CostCenter, Project, Resource
    from api.app.models.planning import DemandLine
    from api.app.models.actuals import ActualLine
    from api.app.models.core import Period, PeriodStatus

    employee_user = User(
        id="emp-ma-1", tenant_id=tenant_id, object_id="emp-oid-ma",
        email="employee.ma@test.com", display_name="MA Employee",
        role="Employee", is_active=True,
    )
    db.add(employee_user)
    db.flush()

    cc = CostCenter(
        id="cc-ma-1", tenant_id=tenant_id, code="CC-MA1",
        name="MA CC", is_active=True,
    )
    db.add(cc)
    db.flush()

    project = Project(
        id="proj-ma-1", tenant_id=tenant_id, code="PR-MA1",
        name="MA Project", is_active=True,
    )
    db.add(project)
    db.flush()

    resource = Resource(
        id="res-ma-1", tenant_id=tenant_id, cost_center_id=cc.id,
        user_id=employee_user.id, employee_id="EMP-MA1",
        display_name="MA Resource", is_active=True,
    )
    db.add(resource)
    db.flush()

    period = Period(
        id="period-ma-1", tenant_id=tenant_id, year=2026, month=6,
        status=PeriodStatus.OPEN,
    )
    db.add(period)
    db.flush()

    demand = DemandLine(
        id="demand-ma1", tenant_id=tenant_id, period_id=period.id,
        project_id=project.id, resource_id=resource.id,
        year=2026, month=6, fte_percent=50, created_by=employee_user.id,
    )
    db.add(demand)

    # Actual line — unsigned (employee_signed_at is None)
    actual = ActualLine(
        id="actual-ma1", tenant_id=tenant_id, period_id=period.id,
        resource_id=resource.id, project_id=project.id,
        year=2026, month=6, actual_fte_percent=50,
        created_by=employee_user.id,
    )
    db.add(actual)
    db.commit()


# ---------------------------------------------------------------------------
# Conflict alert endpoint tests
# ---------------------------------------------------------------------------

def test_conflict_alerts_requires_auth(client):
    """Non-admin/finance roles cannot trigger conflict alerts."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}
    response = client.post(
        "/notifications/run-conflict-alerts?year=2026&month=6",
        headers=headers,
    )
    assert response.status_code == 403


def test_run_conflict_alerts_no_conflicts(client):
    """Returns sent=0 when there are no conflicts."""
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    response = client.post(
        "/notifications/run-conflict-alerts?year=2026&month=7",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["phase"] == "ConflictAlert"
    assert data["conflicts"] == 0
    assert data["sent"] == 0


def test_run_conflict_alerts_sends_notifications(client, db):
    """Sends notifications when demand exceeds supply."""
    _seed_conflict_data(db, "test-tenant")

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    response = client.post(
        "/notifications/run-conflict-alerts?year=2026&month=6",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["phase"] == "ConflictAlert"
    assert data["conflicts"] >= 1
    assert data["sent"] >= 1
    assert "run_id" in data


def test_run_conflict_alerts_idempotent(client, db):
    """Second run skips already-sent recipients."""
    _seed_conflict_data(db, "test-tenant")

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    params = "?year=2026&month=6"

    first = client.post(f"/notifications/run-conflict-alerts{params}", headers=headers)
    assert first.status_code == 200
    first_data = first.json()
    assert first_data["sent"] >= 1

    second = client.post(f"/notifications/run-conflict-alerts{params}", headers=headers)
    assert second.status_code == 200
    second_data = second.json()
    assert second_data["sent"] == 0
    assert second_data["skipped"] == first_data["sent"]


def test_preview_conflict_alerts(client, db):
    """Preview returns conflict list without sending."""
    _seed_conflict_data(db, "test-tenant")

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    response = client.get(
        "/notifications/preview-conflict-alerts?year=2026&month=6",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "conflicts_count" in data
    assert data["conflicts_count"] >= 1


# ---------------------------------------------------------------------------
# Missing actuals endpoint tests
# ---------------------------------------------------------------------------

def test_missing_actuals_requires_auth(client):
    """Non-admin/finance roles cannot trigger missing actuals alerts."""
    headers = {"X-Dev-Role": "Employee", "X-Dev-Tenant": "test-tenant"}
    response = client.post(
        "/notifications/run-missing-actuals?year=2026&month=6",
        headers=headers,
    )
    assert response.status_code == 403


def test_run_missing_actuals_no_missing(client):
    """Returns sent=0 when there are no missing actuals."""
    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    response = client.post(
        "/notifications/run-missing-actuals?year=2026&month=8",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["phase"] == "MissingActuals"
    assert data["missing"] == 0
    assert data["sent"] == 0


def test_run_missing_actuals_sends_notifications(client, db):
    """Sends notifications when employee has unsigned actuals."""
    _seed_missing_actuals_data(db, "test-tenant")

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    response = client.post(
        "/notifications/run-missing-actuals?year=2026&month=6",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["phase"] == "MissingActuals"
    assert data["missing"] >= 1
    assert data["sent"] >= 1
    assert "run_id" in data


def test_run_missing_actuals_idempotent(client, db):
    """Second run skips already-sent recipients."""
    _seed_missing_actuals_data(db, "test-tenant")

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    params = "?year=2026&month=6"

    first = client.post(f"/notifications/run-missing-actuals{params}", headers=headers)
    assert first.status_code == 200
    first_data = first.json()
    assert first_data["sent"] >= 1

    second = client.post(f"/notifications/run-missing-actuals{params}", headers=headers)
    assert second.status_code == 200
    second_data = second.json()
    assert second_data["sent"] == 0
    assert second_data["skipped"] == first_data["sent"]


def test_logs_include_resource_id(client, db):
    """ConflictAlert logs expose resource_id in the response."""
    _seed_conflict_data(db, "test-tenant")

    headers = {"X-Dev-Role": "Finance", "X-Dev-Tenant": "test-tenant"}
    client.post(
        "/notifications/run-conflict-alerts?year=2026&month=6",
        headers=headers,
    )

    response = client.get(
        "/notifications/logs?phase=ConflictAlert",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["resource_id"] is not None
