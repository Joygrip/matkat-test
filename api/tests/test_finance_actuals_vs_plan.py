import pytest


_FINANCE_HEADERS = {
    "X-Dev-Role": "Finance",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "finance-001",
    "X-Dev-Email": "finance@test.com",
    "X-Dev-Name": "Finance User",
}


def test_actuals_vs_plan_endpoint(client):
    response = client.get("/finance/actuals-vs-plan?year=2026&month=2", headers=_FINANCE_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if data:
        row = data[0]
        assert "cost_center_id" in row
        assert "cost_center_name" in row
        assert "demand_fte" in row
        assert "supply_fte" in row
        assert "actuals_fte" in row
