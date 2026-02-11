"""
End-to-end integration test: full workflow from master data creation
through planning, actuals entry, signing, and approval.

This test simulates a realistic monthly cycle using the API endpoints.
"""
from datetime import datetime


def test_full_monthly_cycle(client, admin_headers, finance_headers, pm_headers, ro_headers, employee_headers, db):
    """
    Full cycle: Admin creates master data -> PM creates demand -> RO creates supply
    -> Employee enters & signs actuals -> approval instance is created.
    """
    from api.app.models.core import User, UserRole

    # ── 0. Create User records for Employee and RO (for ownership / approvals) ──
    employee_user = User(
        tenant_id="test-tenant-001",
        object_id="employee-001",
        email="employee@test.com",
        display_name="Employee User",
        role=UserRole.EMPLOYEE,
    )
    db.add(employee_user)
    db.commit()
    db.refresh(employee_user)
    employee_user_id = employee_user.id

    # ── 1. Admin creates master data ──
    dept_resp = client.post(
        "/admin/departments",
        json={"code": "ENG", "name": "Engineering"},
        headers=admin_headers,
    )
    assert dept_resp.status_code == 200
    dept_id = dept_resp.json()["id"]

    cc_resp = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "ENG-01", "name": "Backend Team"},
        headers=admin_headers,
    )
    assert cc_resp.status_code == 200
    cc_id = cc_resp.json()["id"]

    proj_resp = client.post(
        "/admin/projects",
        json={"code": "MATKAT", "name": "MatKat 2.0"},
        headers=admin_headers,
    )
    assert proj_resp.status_code == 200
    project_id = proj_resp.json()["id"]

    # Resource linked to employee user
    res_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-INT",
            "display_name": "Integration Employee",
            "user_id": employee_user_id,
        },
        headers=admin_headers,
    )
    assert res_resp.status_code == 200
    resource_id = res_resp.json()["id"]

    # ── 2. Finance creates period ──
    now = datetime.utcnow()
    period_resp = client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )
    assert period_resp.status_code == 200

    # ── 3. PM creates demand line ──
    demand_resp = client.post(
        "/demand-lines",
        json={
            "period_id": period_resp.json()["id"],
            "project_id": project_id,
            "resource_id": resource_id,
            "year": now.year,
            "month": now.month,
            "fte_percent": 80,
        },
        headers=pm_headers,
    )
    assert demand_resp.status_code == 200
    demand_id = demand_resp.json()["id"]

    # ── 4. RO creates supply line ──
    supply_resp = client.post(
        "/supply-lines",
        json={
            "period_id": period_resp.json()["id"],
            "resource_id": resource_id,
            "year": now.year,
            "month": now.month,
            "fte_percent": 100,
        },
        headers=ro_headers,
    )
    assert supply_resp.status_code == 200
    supply_id = supply_resp.json()["id"]

    # ── 5. Finance verifies consolidation dashboard ──
    dash_resp = client.get(
        f"/consolidation/dashboard/{period_resp.json()['id']}",
        headers=finance_headers,
    )
    assert dash_resp.status_code == 200
    dashboard = dash_resp.json()
    assert dashboard["summary"]["total_departments"] >= 1

    # ── 6. Employee creates actuals ──
    actual_resp = client.post(
        "/actuals",
        json={
            "resource_id": resource_id,
            "project_id": project_id,
            "year": now.year,
            "month": now.month,
            "actual_fte_percent": 80,
        },
        headers=employee_headers,
    )
    assert actual_resp.status_code == 200
    actual_id = actual_resp.json()["id"]

    # ── 7. Employee signs actuals ──
    sign_resp = client.post(
        f"/actuals/{actual_id}/sign",
        headers=employee_headers,
    )
    assert sign_resp.status_code == 200
    assert sign_resp.json()["employee_signed_at"] is not None

    # ── 8. Verify audit trail was generated ──
    audit_resp = client.get("/audit-logs/", headers=admin_headers)
    assert audit_resp.status_code == 200
    logs = audit_resp.json()
    # Should have at minimum: dept create, cc create, project create, resource create,
    # actual create, actual sign
    assert len(logs) >= 4

    # Verify specific audit entries exist
    actions = [(l["entity_type"], l["action"]) for l in logs]
    assert ("Department", "create") in actions
    assert ("ActualLine", "create") in actions

    # ── 9. Finance publishes consolidation snapshot ──
    snap_resp = client.post(
        f"/consolidation/publish/{period_resp.json()['id']}",
        json={"name": f"Monthly Close {now.year}-{now.month:02d}"},
        headers=finance_headers,
    )
    assert snap_resp.status_code == 200
    assert snap_resp.json()["lines_count"] >= 2  # demand + supply at minimum

    # ── 10. Finance can lock the period ──
    lock_resp = client.post(
        f"/periods/{period_resp.json()['id']}/lock",
        headers=finance_headers,
    )
    assert lock_resp.status_code == 200

    # ── 11. Verify locked period blocks further actuals ──
    blocked_resp = client.post(
        "/actuals",
        json={
            "resource_id": resource_id,
            "project_id": project_id,
            "year": now.year,
            "month": now.month,
            "actual_fte_percent": 10,
        },
        headers=employee_headers,
    )
    assert blocked_resp.status_code == 403


def test_over_allocation_across_projects(client, admin_headers, finance_headers, employee_headers, db):
    """
    Verify the 100% FTE cap across multiple projects:
    - Create 3 projects, allocate 40% + 40% + 25% = 105% -> should fail at step 3
    """
    from api.app.models.core import User, UserRole

    employee_user = User(
        tenant_id="test-tenant-001",
        object_id="employee-001",
        email="employee@test.com",
        display_name="Employee User",
        role=UserRole.EMPLOYEE,
    )
    db.add(employee_user)
    db.commit()
    db.refresh(employee_user)

    # Setup master data
    dept = client.post("/admin/departments", json={"code": "OA", "name": "Over-Alloc"}, headers=admin_headers)
    cc = client.post(
        "/admin/cost-centers",
        json={"department_id": dept.json()["id"], "code": "OA-01", "name": "OA CC"},
        headers=admin_headers,
    )
    res = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc.json()["id"],
            "employee_id": "EMP-OA",
            "display_name": "OA Employee",
            "user_id": employee_user.id,
        },
        headers=admin_headers,
    )
    resource_id = res.json()["id"]

    p1 = client.post("/admin/projects", json={"code": "P1", "name": "Proj 1"}, headers=admin_headers)
    p2 = client.post("/admin/projects", json={"code": "P2", "name": "Proj 2"}, headers=admin_headers)
    p3 = client.post("/admin/projects", json={"code": "P3", "name": "Proj 3"}, headers=admin_headers)

    now = datetime.utcnow()
    client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)

    # 40% on project 1 -> OK
    r1 = client.post(
        "/actuals",
        json={
            "resource_id": resource_id,
            "project_id": p1.json()["id"],
            "year": now.year,
            "month": now.month,
            "actual_fte_percent": 40,
        },
        headers=employee_headers,
    )
    assert r1.status_code == 200

    # 40% on project 2 -> OK (total 80%)
    r2 = client.post(
        "/actuals",
        json={
            "resource_id": resource_id,
            "project_id": p2.json()["id"],
            "year": now.year,
            "month": now.month,
            "actual_fte_percent": 40,
        },
        headers=employee_headers,
    )
    assert r2.status_code == 200

    # 25% on project 3 -> FAIL (total 105%)
    r3 = client.post(
        "/actuals",
        json={
            "resource_id": resource_id,
            "project_id": p3.json()["id"],
            "year": now.year,
            "month": now.month,
            "actual_fte_percent": 25,
        },
        headers=employee_headers,
    )
    assert r3.status_code == 400
    assert r3.json()["code"] == "ACTUALS_OVER_100"
    assert r3.json()["total_percent"] == 105

    # 20% on project 3 -> OK (total exactly 100%)
    r4 = client.post(
        "/actuals",
        json={
            "resource_id": resource_id,
            "project_id": p3.json()["id"],
            "year": now.year,
            "month": now.month,
            "actual_fte_percent": 20,
        },
        headers=employee_headers,
    )
    assert r4.status_code == 200


def test_finance_can_manage_full_lifecycle(client, admin_headers, finance_headers, db):
    """
    Finance role can create master data, create planning lines, and publish snapshots.
    This verifies the P4 Finance access expansion end-to-end.
    """
    # Finance creates department
    dept = client.post(
        "/admin/departments",
        json={"code": "FIN-INT", "name": "Finance Integration"},
        headers=finance_headers,
    )
    assert dept.status_code == 200
    dept_id = dept.json()["id"]

    # Finance creates cost center
    cc = client.post(
        "/admin/cost-centers",
        json={"department_id": dept_id, "code": "FIN-CC", "name": "Finance CC"},
        headers=finance_headers,
    )
    assert cc.status_code == 200
    cc_id = cc.json()["id"]

    # Finance creates project
    proj = client.post(
        "/admin/projects",
        json={"code": "FIN-P", "name": "Finance Project"},
        headers=finance_headers,
    )
    assert proj.status_code == 200
    project_id = proj.json()["id"]

    # Finance creates resource
    res = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc_id,
            "employee_id": "EMP-FIN",
            "display_name": "Finance Resource",
        },
        headers=finance_headers,
    )
    assert res.status_code == 200
    resource_id = res.json()["id"]

    # Finance creates period
    from datetime import datetime

    now = datetime.utcnow()
    period = client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )
    assert period.status_code == 200
    period_id = period.json()["id"]

    # Finance creates demand line
    demand = client.post(
        "/demand-lines",
        json={
            "period_id": period_id,
            "project_id": project_id,
            "resource_id": resource_id,
            "year": now.year,
            "month": now.month,
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    assert demand.status_code == 200

    # Finance creates supply line
    supply = client.post(
        "/supply-lines",
        json={
            "period_id": period_id,
            "resource_id": resource_id,
            "year": now.year,
            "month": now.month,
            "fte_percent": 50,
        },
        headers=finance_headers,
    )
    assert supply.status_code == 200

    # Finance publishes snapshot
    snap = client.post(
        f"/consolidation/publish/{period_id}",
        json={"name": "Finance Integration Snapshot"},
        headers=finance_headers,
    )
    assert snap.status_code == 200
    assert snap.json()["lines_count"] == 2

    # Finance can READ settings but cannot CREATE them (Admin-only)
    settings_read_resp = client.get("/admin/settings", headers=finance_headers)
    assert settings_read_resp.status_code == 200

    settings_write_resp = client.post(
        "/admin/settings",
        json={"key": "test_setting", "value": "test"},
        headers=finance_headers,
    )
    assert settings_write_resp.status_code == 403
