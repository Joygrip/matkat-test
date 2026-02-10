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
    
    # Create a Director user
    user = User(
        id="director-1",
        tenant_id=tenant_id,
        object_id="director-oid",
        email="director@test.com",
        display_name="Director User",
        role="Director",
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
