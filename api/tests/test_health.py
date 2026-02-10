"""Tests for health endpoint."""


def test_health_check(client):
    """Test health check returns healthy status."""
    response = client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert "environment" in data
