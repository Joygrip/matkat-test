"""Tests for /me endpoint."""


def test_me_returns_user_info(client, admin_headers):
    """Test /me returns current user information."""
    response = client.get("/me", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["tenant_id"] == "test-tenant-001"
    assert data["object_id"] == "admin-001"
    assert data["email"] == "admin@test.com"
    assert data["display_name"] == "Admin User"
    assert data["role"] == "Admin"
    assert "permissions" in data


def test_me_different_roles(client, employee_headers, finance_headers):
    """Test /me returns correct role for different users."""
    # Employee
    response = client.get("/me", headers=employee_headers)
    assert response.status_code == 200
    assert response.json()["role"] == "Employee"
    
    # Finance
    response = client.get("/me", headers=finance_headers)
    assert response.status_code == 200
    assert response.json()["role"] == "Finance"


def test_me_permissions_vary_by_role(client, admin_headers, employee_headers):
    """Test permissions differ by role."""
    admin_response = client.get("/me", headers=admin_headers)
    employee_response = client.get("/me", headers=employee_headers)
    
    admin_perms = admin_response.json()["permissions"]
    employee_perms = employee_response.json()["permissions"]
    
    # Admin should have more permissions
    assert len(admin_perms) > len(employee_perms)
    assert "admin:*" in admin_perms
    assert "admin:*" not in employee_perms
