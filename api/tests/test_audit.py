"""Tests for audit log endpoint and audit trail generation."""
from datetime import datetime, timezone

from api.app.models.audit import AuditLog


def test_audit_endpoint_requires_admin_or_finance(client, employee_headers, pm_headers, db):
    """Only Admin and Finance can access audit logs."""
    # Employee -> 403
    resp = client.get("/audit-logs/", headers=employee_headers)
    assert resp.status_code == 403

    # PM -> 403
    resp = client.get("/audit-logs/", headers=pm_headers)
    assert resp.status_code == 403


def test_admin_can_read_audit_logs(client, admin_headers, db):
    """Admin can read the audit-log endpoint."""
    resp = client.get("/audit-logs/", headers=admin_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_finance_can_read_audit_logs(client, finance_headers, db):
    """Finance can read the audit-log endpoint."""
    resp = client.get("/audit-logs/", headers=finance_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_audit_logs_are_tenant_scoped(client, admin_headers, db):
    """Audit logs only return entries for the current tenant."""
    # Insert logs for two tenants
    log_own = AuditLog(
        tenant_id="test-tenant-001",
        user_id="user-1",
        user_email="user@test.com",
        action="create",
        entity_type="Department",
        entity_id="dept-1",
        timestamp=datetime.now(timezone.utc),
    )
    log_other = AuditLog(
        tenant_id="other-tenant",
        user_id="user-2",
        user_email="other@test.com",
        action="create",
        entity_type="Department",
        entity_id="dept-2",
        timestamp=datetime.now(timezone.utc),
    )
    db.add_all([log_own, log_other])
    db.commit()

    resp = client.get("/audit-logs/", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Should only see own tenant's log
    assert len(data) == 1
    assert data[0]["entity_id"] == "dept-1"


def test_audit_logs_pagination(client, admin_headers, db):
    """Audit logs support limit/offset pagination."""
    # Insert 5 logs
    for i in range(5):
        db.add(AuditLog(
            tenant_id="test-tenant-001",
            user_id="user-1",
            user_email="user@test.com",
            action="create",
            entity_type="Resource",
            entity_id=f"res-{i}",
            timestamp=datetime.now(timezone.utc),
        ))
    db.commit()

    # Get first 2
    resp = client.get("/audit-logs/?limit=2&offset=0", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    # Get next 2
    resp = client.get("/audit-logs/?limit=2&offset=2", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    # Get remaining
    resp = client.get("/audit-logs/?limit=2&offset=4", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_audit_trail_created_on_admin_crud(client, admin_headers, db):
    """Creating a department via API produces an audit log entry."""
    # Create department (triggers audit log)
    resp = client.post(
        "/admin/departments",
        json={"name": "Audited Dept", "code": "AD"},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    # Check audit logs contain the create action
    logs_resp = client.get("/audit-logs/", headers=admin_headers)
    data = logs_resp.json()
    assert len(data) >= 1
    create_log = next((l for l in data if l["entity_type"] == "Department" and l["action"] == "create"), None)
    assert create_log is not None
    assert create_log["user_email"] == "admin@test.com"


def test_audit_log_returns_ordered_by_timestamp(client, admin_headers, db):
    """Audit logs are returned newest-first."""
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="a@t.com",
        action="create",
        entity_type="A",
        entity_id="old",
        timestamp=now - timedelta(hours=1),
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="a@t.com",
        action="create",
        entity_type="A",
        entity_id="new",
        timestamp=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/", headers=admin_headers)
    data = resp.json()
    assert data[0]["entity_id"] == "new"
    assert data[1]["entity_id"] == "old"
