import pytest
from fastapi.testclient import TestClient
from api.app.main import app

client = TestClient(app)

def test_actuals_vs_plan_endpoint():
    # This test assumes test data is loaded for year=2026, month=2
    response = client.get("/finance/actuals-vs-plan?year=2026&month=2")
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
