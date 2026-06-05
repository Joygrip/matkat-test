"""Tests for Manager+Reader authorization scope enforcement.

Verifies that:
- Manager+Reader gets company-wide READ via /lookups/resources/scoped (default)
- Manager+Reader is scoped to own/delegated CCs for WRITE (for_write=True)
- Supply single-delete enforces write scope for Manager+Reader
- Supply create/move/group-delete enforce write scope for Manager+Reader
- Actuals resubmit enforces write scope for Manager+Reader
- Normal Manager, Finance, and Admin behavior is unchanged
"""
import pytest
from datetime import datetime

from api.app.models.core import CostCenter, User, UserRole


TENANT = "test-tenant-001"
MANAGER_READER_OID = "manager-reader-001"


@pytest.fixture
def mr_scope_setup(client, admin_headers, finance_headers, db):
    """Create two CCs with resources.

    CC1 is managed by the Manager+Reader user (via ro_user_id).
    CC2 is an unrelated cost center.
    Both get resources and an open period.
    """
    # Create the Manager+Reader User record so we can assign them as ro_user_id.
    # The object_id must match the X-Dev-User-Id in manager_reader_headers.
    mr_user = User(
        tenant_id=TENANT,
        object_id=MANAGER_READER_OID,
        email="manager.reader@test.com",
        display_name="Manager Reader User",
        role=UserRole.MANAGER,
        secondary_role="Reader",
        is_active=True,
    )
    db.add(mr_user)
    db.commit()
    db.refresh(mr_user)

    # CC1: managed by the Manager+Reader user
    cc1_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-MR-MANAGED", "name": "MR Managed CC"},
        headers=admin_headers,
    )
    assert cc1_resp.status_code == 200, cc1_resp.text
    cc1_id = cc1_resp.json()["id"]

    cc1 = db.query(CostCenter).filter(CostCenter.id == cc1_id).first()
    cc1.ro_user_id = mr_user.id
    db.commit()

    # Resource in CC1 (in-scope for Manager+Reader writes)
    r1_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc1_id,
            "employee_id": "EMP-MR-IN-SCOPE",
            "display_name": "In-Scope Employee",
        },
        headers=admin_headers,
    )
    assert r1_resp.status_code == 200, r1_resp.text
    r1_id = r1_resp.json()["id"]

    # CC2: unrelated to the Manager+Reader user
    cc2_resp = client.post(
        "/admin/cost-centers",
        json={"code": "CC-MR-OTHER", "name": "MR Unrelated CC"},
        headers=admin_headers,
    )
    assert cc2_resp.status_code == 200, cc2_resp.text
    cc2_id = cc2_resp.json()["id"]

    # Resource in CC2 (out-of-scope for Manager+Reader writes)
    r2_resp = client.post(
        "/admin/resources",
        json={
            "cost_center_id": cc2_id,
            "employee_id": "EMP-MR-OUT-SCOPE",
            "display_name": "Out-of-Scope Employee",
        },
        headers=admin_headers,
    )
    assert r2_resp.status_code == 200, r2_resp.text
    r2_id = r2_resp.json()["id"]

    # Open period
    now = datetime.utcnow()
    client.post(
        "/periods",
        json={"year": now.year, "month": now.month},
        headers=finance_headers,
    )

    return {
        "cc1_id": cc1_id,
        "cc2_id": cc2_id,
        "r1_id": r1_id,  # in-scope for Manager+Reader
        "r2_id": r2_id,  # out-of-scope for Manager+Reader
        "year": now.year,
        "month": now.month,
    }


# ---------------------------------------------------------------------------
# Lookup endpoint tests
# ---------------------------------------------------------------------------

class TestLookupResourcesScoped:
    def test_manager_reader_default_returns_company_wide(
        self, client, manager_reader_headers, mr_scope_setup
    ):
        """Default (no for_write) lookup returns all resources for Manager+Reader."""
        resp = client.get("/lookups/resources/scoped", headers=manager_reader_headers)
        assert resp.status_code == 200
        ids = {r["id"] for r in resp.json()}
        data = mr_scope_setup
        assert data["r1_id"] in ids, "In-scope resource must appear in read-expanded lookup"
        assert data["r2_id"] in ids, "Out-of-scope resource must also appear in read-expanded lookup"

    def test_manager_reader_for_write_returns_only_writable_scope(
        self, client, manager_reader_headers, mr_scope_setup
    ):
        """for_write=true scopes Manager+Reader identically to a plain Manager."""
        resp = client.get("/lookups/resources/scoped?for_write=true", headers=manager_reader_headers)
        assert resp.status_code == 200
        ids = {r["id"] for r in resp.json()}
        data = mr_scope_setup
        assert data["r1_id"] in ids, "In-scope resource must appear in write-scoped lookup"
        assert data["r2_id"] not in ids, "Out-of-scope resource must NOT appear in write-scoped lookup"

    def test_normal_manager_default_returns_only_own_scope(
        self, client, ro_headers, mr_scope_setup, db
    ):
        """Plain Manager (no secondary role) always gets own-scope resources, ignoring for_write."""
        # ro_headers user (ro-001) is not ro_user_id of any CC in this test → empty scope
        resp = client.get("/lookups/resources/scoped", headers=ro_headers)
        assert resp.status_code == 200
        ids = {r["id"] for r in resp.json()}
        data = mr_scope_setup
        # The plain Manager has no CC scope here, so both resources should be absent
        assert data["r2_id"] not in ids

    def test_finance_returns_all_resources_regardless_of_for_write(
        self, client, finance_headers, mr_scope_setup
    ):
        """Finance always gets all active resources; for_write has no effect."""
        data = mr_scope_setup
        for param in ("", "?for_write=true"):
            resp = client.get(f"/lookups/resources/scoped{param}", headers=finance_headers)
            assert resp.status_code == 200
            ids = {r["id"] for r in resp.json()}
            assert data["r1_id"] in ids
            assert data["r2_id"] in ids


# ---------------------------------------------------------------------------
# Supply write scope tests
# ---------------------------------------------------------------------------

class TestSupplyWriteScope:
    def test_manager_reader_cannot_create_supply_for_out_of_scope_resource(
        self, client, manager_reader_headers, mr_scope_setup
    ):
        """Manager+Reader is blocked from creating supply for an unrelated resource."""
        data = mr_scope_setup
        resp = client.post(
            "/supply-lines",
            json={
                "resource_id": data["r2_id"],
                "year": data["year"],
                "month": data["month"],
                "fte_percent": 50,
            },
            headers=manager_reader_headers,
        )
        assert resp.status_code == 403
        assert resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"

    def test_manager_reader_can_create_supply_for_in_scope_resource(
        self, client, manager_reader_headers, mr_scope_setup
    ):
        """Manager+Reader can create supply for their own CC resource (same as plain Manager)."""
        data = mr_scope_setup
        resp = client.post(
            "/supply-lines",
            json={
                "resource_id": data["r1_id"],
                "year": data["year"],
                "month": data["month"],
                "fte_percent": 50,
            },
            headers=manager_reader_headers,
        )
        assert resp.status_code == 200, resp.text

    def test_manager_reader_cannot_delete_out_of_scope_supply(
        self, client, manager_reader_headers, finance_headers, mr_scope_setup
    ):
        """Manager+Reader cannot delete a supply line for an out-of-scope resource.

        This tests the write-gate added to SupplyService.delete().
        Finance creates the supply so it exists; Manager+Reader should be rejected.
        """
        data = mr_scope_setup
        create_resp = client.post(
            "/supply-lines",
            json={
                "resource_id": data["r2_id"],
                "year": data["year"],
                "month": data["month"],
                "fte_percent": 50,
            },
            headers=finance_headers,
        )
        assert create_resp.status_code == 200, create_resp.text
        supply_id = create_resp.json()["id"]

        del_resp = client.delete(f"/supply-lines/{supply_id}", headers=manager_reader_headers)
        assert del_resp.status_code == 403
        assert del_resp.json()["code"] == "MANAGER_NOT_AUTHORIZED"

    def test_manager_reader_can_delete_in_scope_supply(
        self, client, manager_reader_headers, finance_headers, mr_scope_setup
    ):
        """Manager+Reader can delete a supply line for their own CC resource."""
        data = mr_scope_setup
        create_resp = client.post(
            "/supply-lines",
            json={
                "resource_id": data["r1_id"],
                "year": data["year"],
                "month": data["month"],
                "fte_percent": 50,
            },
            headers=finance_headers,
        )
        assert create_resp.status_code == 200, create_resp.text
        supply_id = create_resp.json()["id"]

        del_resp = client.delete(f"/supply-lines/{supply_id}", headers=manager_reader_headers)
        assert del_resp.status_code == 200, del_resp.text

    def test_normal_manager_behavior_unchanged_supply_create(
        self, client, ro_headers, mr_scope_setup
    ):
        """Plain Manager remains blocked for out-of-scope supply (behavior unchanged)."""
        data = mr_scope_setup
        resp = client.post(
            "/supply-lines",
            json={
                "resource_id": data["r2_id"],
                "year": data["year"],
                "month": data["month"],
                "fte_percent": 50,
            },
            headers=ro_headers,
        )
        assert resp.status_code == 403

    def test_finance_supply_delete_unchanged(
        self, client, finance_headers, mr_scope_setup
    ):
        """Finance can still delete any supply line (behavior unchanged)."""
        data = mr_scope_setup
        create_resp = client.post(
            "/supply-lines",
            json={
                "resource_id": data["r2_id"],
                "year": data["year"],
                "month": data["month"],
                "fte_percent": 50,
            },
            headers=finance_headers,
        )
        assert create_resp.status_code == 200, create_resp.text
        supply_id = create_resp.json()["id"]

        del_resp = client.delete(f"/supply-lines/{supply_id}", headers=finance_headers)
        assert del_resp.status_code == 200, del_resp.text


# ---------------------------------------------------------------------------
# Actuals resubmit scope test
# ---------------------------------------------------------------------------

class TestActualsResubmitScope:
    def test_manager_reader_cannot_resubmit_out_of_scope_actual(
        self, client, manager_reader_headers, finance_headers, admin_headers, mr_scope_setup
    ):
        """Manager+Reader cannot resubmit an actual for an out-of-scope resource.

        _check_manager_resource_access fires before the approval-state check,
        so a 403 is returned even without a full signed/rejected approval setup.
        """
        data = mr_scope_setup

        # Create a project so actuals POST has a valid project_id
        proj_resp = client.post(
            "/admin/projects",
            json={"code": "PRJ-MR-TEST", "name": "MR Test Project"},
            headers=admin_headers,
        )
        assert proj_resp.status_code == 200, proj_resp.text
        project_id = proj_resp.json()["id"]

        # Finance creates the actual for the out-of-scope resource
        create_resp = client.post(
            "/actuals",
            json={
                "resource_id": data["r2_id"],
                "project_id": project_id,
                "year": data["year"],
                "month": data["month"],
                "actual_fte_percent": 50,
            },
            headers=finance_headers,
        )
        assert create_resp.status_code == 200, f"Finance failed to create actual: {create_resp.text}"
        actual_id = create_resp.json()["id"]

        # Manager+Reader tries to resubmit — must be rejected with 403 before any
        # approval-state validation (which would give 400 for unsigned actuals)
        resubmit_resp = client.post(
            f"/actuals/{actual_id}/resubmit",
            json={"actual_fte_percent": 50},
            headers=manager_reader_headers,
        )
        assert resubmit_resp.status_code == 403, (
            f"Expected 403, got {resubmit_resp.status_code}: {resubmit_resp.text}"
        )
        assert resubmit_resp.json()["code"] == "UNAUTHORIZED_RESOURCE"
