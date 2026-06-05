"""Tests for audit log endpoint and audit trail generation."""
from datetime import datetime, timezone, timedelta

from api.app.models.audit import AuditLog


def _items(resp):
    """Extract items list from new paginated response shape."""
    data = resp.json()
    assert "items" in data, f"Expected 'items' key, got: {data}"
    assert "has_more" in data, f"Expected 'has_more' key, got: {data}"
    return data["items"]


def test_audit_endpoint_requires_admin_or_finance(client, employee_headers, pm_headers, db):
    """Only Admin and Finance can access audit logs."""
    resp = client.get("/audit-logs/", headers=employee_headers)
    assert resp.status_code == 403

    resp = client.get("/audit-logs/", headers=pm_headers)
    assert resp.status_code == 403


def test_admin_can_read_audit_logs(client, admin_headers, db):
    """Admin can read the audit-log endpoint."""
    resp = client.get("/audit-logs/", headers=admin_headers)
    assert resp.status_code == 200
    items = _items(resp)
    assert isinstance(items, list)


def test_finance_can_read_audit_logs(client, finance_headers, db):
    """Finance can read the audit-log endpoint."""
    resp = client.get("/audit-logs/", headers=finance_headers)
    assert resp.status_code == 200
    items = _items(resp)
    assert isinstance(items, list)


def test_audit_logs_are_tenant_scoped(client, admin_headers, db):
    """Audit logs only return entries for the current tenant."""
    log_own = AuditLog(
        tenant_id="test-tenant-001",
        user_id="user-1",
        user_email="user@test.com",
        action="create",
        entity_type="CostCenter",
        entity_id="cc-1",
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    log_other = AuditLog(
        tenant_id="other-tenant",
        user_id="user-2",
        user_email="other@test.com",
        action="create",
        entity_type="CostCenter",
        entity_id="cc-2",
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add_all([log_own, log_other])
    db.commit()

    resp = client.get("/audit-logs/", headers=admin_headers)
    assert resp.status_code == 200
    items = _items(resp)
    assert len(items) == 1
    assert items[0]["entity_id"] == "cc-1"


def test_audit_logs_pagination(client, admin_headers, db):
    """Audit logs support limit/offset pagination and has_more flag."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for i in range(5):
        db.add(AuditLog(
            tenant_id="test-tenant-001",
            user_id="user-1",
            user_email="user@test.com",
            action="create",
            entity_type="Resource",
            entity_id=f"res-{i}",
            created_at=now - timedelta(seconds=i),
        ))
    db.commit()

    resp = client.get("/audit-logs/?limit=2&offset=0", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["has_more"] is True

    resp = client.get("/audit-logs/?limit=2&offset=2", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["has_more"] is True

    resp = client.get("/audit-logs/?limit=2&offset=4", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["has_more"] is False


def test_audit_logs_default_limit_is_50(client, admin_headers, db):
    """Default page size is 50."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for i in range(60):
        db.add(AuditLog(
            tenant_id="test-tenant-001",
            user_id="u1",
            user_email="u@t.com",
            action="create",
            entity_type="Resource",
            entity_id=f"r-{i}",
            created_at=now - timedelta(seconds=i),
        ))
    db.commit()

    resp = client.get("/audit-logs/", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 50
    assert data["has_more"] is True


def test_audit_logs_limit_capped_at_100(client, admin_headers, db):
    """limit=1000 is rejected (exceeds max of 100). FastAPI may return 400 or 422."""
    resp = client.get("/audit-logs/?limit=1000", headers=admin_headers)
    assert resp.status_code in (400, 422)


def test_audit_logs_filter_by_action(client, admin_headers, db):
    """action filter returns only matching entries."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="Resource",
        entity_id="r-1",
        created_at=now,
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="delete",
        entity_type="Resource",
        entity_id="r-2",
        created_at=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/?action=create", headers=admin_headers)
    assert resp.status_code == 200
    items = _items(resp)
    assert all(i["action"] == "create" for i in items)
    entity_ids = {i["entity_id"] for i in items}
    assert "r-1" in entity_ids
    assert "r-2" not in entity_ids


def test_audit_logs_filter_by_entity_type(client, admin_headers, db):
    """entity_type filter returns only matching entries."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="DemandLine",
        entity_id="dl-1",
        created_at=now,
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="SupplyLine",
        entity_id="sl-1",
        created_at=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/?entity_type=DemandLine", headers=admin_headers)
    assert resp.status_code == 200
    items = _items(resp)
    assert all(i["entity_type"] == "DemandLine" for i in items)


def test_audit_logs_filter_by_actor(client, admin_headers, db):
    """actor filter returns only matching user_email entries."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="alice@example.com",
        action="create",
        entity_type="Resource",
        entity_id="r-1",
        created_at=now,
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u2",
        user_email="bob@example.com",
        action="create",
        entity_type="Resource",
        entity_id="r-2",
        created_at=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/?actor=alice", headers=admin_headers)
    assert resp.status_code == 200
    items = _items(resp)
    assert all("alice" in i["user_email"] for i in items)


def test_audit_logs_filter_by_date_range(client, admin_headers, db):
    """from_date/to_date filter returns entries within range."""
    base = datetime(2026, 1, 15, 12, 0, 0)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="Resource",
        entity_id="early",
        created_at=datetime(2026, 1, 10, 0, 0, 0),
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="Resource",
        entity_id="in-range",
        created_at=base,
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="Resource",
        entity_id="late",
        created_at=datetime(2026, 1, 20, 0, 0, 0),
    ))
    db.commit()

    resp = client.get(
        "/audit-logs/?from_date=2026-01-12&to_date=2026-01-16",
        headers=admin_headers,
    )
    assert resp.status_code == 200
    items = _items(resp)
    entity_ids = {i["entity_id"] for i in items}
    assert "in-range" in entity_ids
    assert "early" not in entity_ids
    assert "late" not in entity_ids


def test_audit_logs_filter_by_q(client, admin_headers, db):
    """q text search matches against action and reason fields."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="approve",
        entity_type="ApprovalStep",
        entity_id="as-1",
        reason="Budget approved by director",
        created_at=now,
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="reject",
        entity_type="ApprovalStep",
        entity_id="as-2",
        reason="Headcount exceeded",
        created_at=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/?q=Budget", headers=admin_headers)
    assert resp.status_code == 200
    items = _items(resp)
    entity_ids = {i["entity_id"] for i in items}
    assert "as-1" in entity_ids
    assert "as-2" not in entity_ids


def test_audit_trail_created_on_admin_crud(client, admin_headers, db):
    """Creating a cost center via API produces an audit log entry."""
    resp = client.post(
        "/admin/cost-centers",
        json={"name": "Audited CC", "code": "ACC"},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    logs_resp = client.get("/audit-logs/", headers=admin_headers)
    items = _items(logs_resp)
    assert len(items) >= 1
    create_log = next(
        (l for l in items if l["entity_type"] == "CostCenter" and l["action"] == "create"),
        None,
    )
    assert create_log is not None
    assert create_log["user_email"] == "admin@test.com"


def test_audit_log_returns_ordered_by_timestamp(client, admin_headers, db):
    """Audit logs are returned newest-first."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="a@t.com",
        action="create",
        entity_type="A",
        entity_id="old",
        created_at=now - timedelta(hours=1),
    ))
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="a@t.com",
        action="create",
        entity_type="A",
        entity_id="new",
        created_at=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/", headers=admin_headers)
    items = _items(resp)
    assert items[0]["entity_id"] == "new"
    assert items[1]["entity_id"] == "old"


def test_audit_log_response_includes_id_and_timestamp_utc(client, admin_headers, db):
    """Response includes id field and timestamp ends with Z (UTC marker)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(AuditLog(
        tenant_id="test-tenant-001",
        user_id="u1",
        user_email="u@t.com",
        action="create",
        entity_type="Resource",
        entity_id="r-ts",
        created_at=now,
    ))
    db.commit()

    resp = client.get("/audit-logs/", headers=admin_headers)
    items = _items(resp)
    entry = next(i for i in items if i["entity_id"] == "r-ts")
    assert "id" in entry
    assert entry["id"] is not None
    assert entry["timestamp"].endswith("Z"), "Timestamp must end with Z (UTC)"
