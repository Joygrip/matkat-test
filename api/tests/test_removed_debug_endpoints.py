"""Security regression tests: debug/diagnostic endpoints removed in the
2026-06 security review must stay removed.

- /admin/sync/check-graph-user/{object_id} leaked raw Graph profiles
- /admin/sync/check-graph-list/{email} leaked org-wide directory data
- /admin/sync/debug-import-departments returned raw stack traces to clients
- /dashboard/aggregation exposed org-wide planning data to every authenticated user
"""

ADMIN_HEADERS = {
    "X-Dev-Role": "Admin",
    "X-Dev-Tenant": "test-tenant",
    "X-Dev-User-Id": "admin-removed-ep-001",
}


def test_check_graph_user_endpoint_removed(client):
    response = client.get(
        "/admin/sync/check-graph-user/some-object-id", headers=ADMIN_HEADERS
    )
    assert response.status_code == 404


def test_check_graph_list_endpoint_removed(client):
    response = client.get(
        "/admin/sync/check-graph-list/someone@example.com", headers=ADMIN_HEADERS
    )
    assert response.status_code == 404


def test_debug_import_departments_endpoint_removed(client):
    response = client.post(
        "/admin/sync/debug-import-departments", headers=ADMIN_HEADERS
    )
    assert response.status_code in (404, 405)


def test_dashboard_aggregation_endpoint_removed(client):
    employee_headers = {
        "X-Dev-Role": "Employee",
        "X-Dev-Tenant": "test-tenant",
        "X-Dev-User-Id": "employee-removed-ep-001",
    }
    response = client.get("/dashboard/aggregation", headers=employee_headers)
    assert response.status_code == 404
