"""Tests for lookups endpoints - read-only access for all roles."""
import pytest


def test_pm_can_list_projects(client, pm_headers):
    """PM can list projects via lookups endpoint."""
    response = client.get("/lookups/projects", headers=pm_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_pm_can_list_resources(client, pm_headers):
    """PM can list resources via lookups endpoint."""
    response = client.get("/lookups/resources", headers=pm_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_pm_can_list_placeholders(client, pm_headers):
    """PM can list placeholders via lookups endpoint."""
    response = client.get("/lookups/placeholders", headers=pm_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_ro_can_list_resources(client, ro_headers):
    """RO can list resources via lookups endpoint."""
    response = client.get("/lookups/resources", headers=ro_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_employee_can_list_projects(client, employee_headers):
    """Employee can list projects via lookups endpoint."""
    response = client.get("/lookups/projects", headers=employee_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_employee_can_list_resources(client, employee_headers):
    """Employee can list resources via lookups endpoint."""
    response = client.get("/lookups/resources", headers=employee_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_pm_cannot_create_project_via_admin(client, pm_headers):
    """PM cannot create projects via admin endpoint."""
    response = client.post(
        "/admin/projects",
        json={"code": "TEST", "name": "Test Project"},
        headers=pm_headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "UNAUTHORIZED_ROLE"


def test_lookups_filter_by_tenant(client, pm_headers, db):
    """Lookups endpoints filter by tenant_id."""
    from api.app.models.core import Project
    
    # Create project in test-tenant-001 (from pm_headers)
    project1 = Project(
        tenant_id="test-tenant-001",
        code="PRJ-001",
        name="Project 1",
    )
    db.add(project1)
    
    # Create project in different tenant
    project2 = Project(
        tenant_id="tenant-002",
        code="PRJ-002",
        name="Project 2",
    )
    db.add(project2)
    db.commit()
    
    # PM in test-tenant-001 should only see project1 (and any seeded projects)
    response = client.get("/lookups/projects", headers=pm_headers)
    assert response.status_code == 200
    projects = response.json()
    assert len(projects) >= 1
    assert all(p["tenant_id"] == "test-tenant-001" for p in projects)
    assert any(p["code"] == "PRJ-001" for p in projects)
