"""Tests for GET /lookups/users endpoint."""
import pytest

TENANT = "test-tenant-001"


@pytest.fixture
def setup_users(db):
    """Seed a couple of users with different roles."""
    from api.app.models.core import User

    users = [
        User(id="u-pm-1", tenant_id=TENANT, object_id="oid-pm-1",
             email="pm1@test.com", display_name="Alice PM", role="PM"),
        User(id="u-pm-2", tenant_id=TENANT, object_id="oid-pm-2",
             email="pm2@test.com", display_name="Bob PM", role="PM"),
        User(id="u-finance-1", tenant_id=TENANT, object_id="oid-fin-1",
             email="fin@test.com", display_name="Carol Finance", role="Finance"),
        User(id="u-admin-1", tenant_id=TENANT, object_id="oid-adm-1",
             email="adm@test.com", display_name="Dave Admin", role="Admin"),
        # Inactive user — should be excluded
        User(id="u-inactive", tenant_id=TENANT, object_id="oid-inactive",
             email="inactive@test.com", display_name="Inactive User", role="PM",
             is_active=False),
        # Different tenant — should be excluded
        User(id="u-other-tenant", tenant_id="other-tenant", object_id="oid-other",
             email="other@test.com", display_name="Other Tenant PM", role="PM"),
    ]
    for u in users:
        db.add(u)
    db.commit()


def test_list_users_requires_admin_or_finance(client):
    """PM and below cannot access /lookups/users."""
    pm_headers = {"X-Dev-Role": "PM", "X-Dev-Tenant": TENANT,
                  "X-Dev-User-Id": "some-pm", "X-Dev-Email": "x@x.com", "X-Dev-Name": "X"}
    resp = client.get("/lookups/users", headers=pm_headers)
    assert resp.status_code == 403


def test_list_users_returns_all_active_users(client, admin_headers, setup_users):
    """Admin can list all active users for the tenant."""
    resp = client.get("/lookups/users", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    emails = {u["email"] for u in data}
    # Active users in the tenant
    assert "pm1@test.com" in emails
    assert "pm2@test.com" in emails
    assert "fin@test.com" in emails
    assert "adm@test.com" in emails
    # Excluded
    assert "inactive@test.com" not in emails
    assert "other@test.com" not in emails


def test_list_users_filter_by_role_pm(client, admin_headers, setup_users):
    """?role=PM returns only PM-role users."""
    resp = client.get("/lookups/users?role=PM", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert all(u["role"] == "PM" for u in data)
    emails = {u["email"] for u in data}
    assert "pm1@test.com" in emails
    assert "pm2@test.com" in emails
    assert "fin@test.com" not in emails


def test_list_users_filter_by_role_finance(client, finance_headers, setup_users):
    """Finance user can also call /lookups/users (needed for PM dropdown)."""
    resp = client.get("/lookups/users?role=Finance", headers=finance_headers)
    assert resp.status_code == 200
    data = resp.json()
    # finance_headers causes the dev-bypass to upsert a second Finance user for the
    # calling user, so the exact count varies. Assert the expected user is present.
    assert any(u["email"] == "fin@test.com" for u in data)
    assert all(u["role"] == "Finance" for u in data)


def test_list_users_response_shape(client, admin_headers, setup_users):
    """Each user record has the expected fields."""
    resp = client.get("/lookups/users?role=PM", headers=admin_headers)
    assert resp.status_code == 200
    for u in resp.json():
        assert "id" in u
        assert "display_name" in u
        assert "email" in u
        assert "role" in u


def test_list_users_sorted_by_display_name(client, admin_headers, setup_users):
    """Users are returned sorted by display_name ascending."""
    resp = client.get("/lookups/users?role=PM", headers=admin_headers)
    names = [u["display_name"] for u in resp.json()]
    assert names == sorted(names)
