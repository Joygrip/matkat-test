"""Tests for dev endpoints."""


def test_dev_seed_creates_data(client, admin_headers, db):
    """Test dev seed endpoint creates sample data."""
    response = client.post("/dev/seed", headers=admin_headers)
    assert response.status_code == 200
    assert "Seeded database" in response.json()["message"]


def test_dev_seed_idempotent(client, admin_headers, db):
    """Test dev seed can be called multiple times."""
    # First seed
    response1 = client.post("/dev/seed", headers=admin_headers)
    assert response1.status_code == 200

    # Second seed should report already seeded
    response2 = client.post("/dev/seed", headers=admin_headers)
    assert response2.status_code == 200
    assert "already seeded" in response2.json()["message"]


def test_dev_config_returns_config(client):
    """Test dev config endpoint returns configuration."""
    response = client.get("/dev/config")
    assert response.status_code == 200
    data = response.json()
    assert "env" in data
    assert "dev_auth_bypass" in data


def test_dev_resources_with_users(client, admin_headers, db):
    """Test dev resources-with-users returns list (empty or with data)."""
    response = client.get("/dev/resources-with-users", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if data:
        row = data[0]
        assert "resource_id" in row
        assert "display_name" in row
        assert "employee_id" in row
        assert "user_object_id" in row
        assert "user_id" in row
