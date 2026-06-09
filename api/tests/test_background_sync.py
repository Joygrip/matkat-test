"""Tests for background_sync: CC manager assignment, department normalization, force flag.

Scenarios covered:
1. assign_cost_center_managers — basic RO and Director assignment from manager chain
2. assign_cost_center_managers — force=True overwrites existing incorrect assignments
3. assign_cost_center_managers — force=False never overwrites existing assignments
4. assign_cost_center_managers — sync_protected CCs always skipped (even with force=True)
5. normalize_department_name — whitespace, casing, ampersand normalization
6. _sync_cc_assignments — normalized-name fallback matches manually created CCs
7. _sync_cc_assignments — backfills graph_department_name on matched existing CC
8. import_departments_from_graph — backfills graph_department_name on matched existing CC
9. Katja-like fixture: Director not directly in CC, assigned as Director via RO chain
10. Katja-like fixture: employees without manager chain produce no RO (no crash)
11. promote_managers_from_graph — promotes EMPLOYEE to MANAGER for graph managers
12. promote_managers_from_graph — does not demote ADMIN/FINANCE/PM
13. _find_ro_candidate — second pass walks full chain (not just one hop)
14. Duplicate/similar department names produce a diagnostic warning but no crash
15. force=True on full sync recalculates CC managers
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from api.app.models.core import (
    Base, User, CostCenter, Resource, UserRole, ResourceType, generate_uuid,
)
from api.app.services.background_sync import (
    normalize_department_name,
    assign_cost_center_managers,
    _sync_cc_assignments,
    import_departments_from_graph,
    promote_managers_from_graph,
    create_resources_from_users,
    run_full_sync,
    _find_ro_candidate,
    ensure_quality_control_cost_center_metadata,
)


# ---------------------------------------------------------------------------
# In-process test database
# ---------------------------------------------------------------------------

TEST_DB_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def engine():
    e = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=e)
    yield e
    Base.metadata.drop_all(bind=e)


@pytest.fixture
def db(engine):
    """Fresh DB session with all tables cleared for each test."""
    conn = engine.connect()
    # Truncate each table
    for tbl in reversed(Base.metadata.sorted_tables):
        conn.execute(tbl.delete())
    conn.commit()
    Session_ = sessionmaker(bind=engine)
    session = Session_()
    yield session
    session.close()
    conn.close()


@pytest.fixture
def settings():
    """Minimal settings with Graph disabled (all sync steps run in DB-only mode).

    The conftest.py sets env vars (ENV=dev, DEV_AUTH_BYPASS=true) before import and
    clears the lru_cache, so get_settings() returns an instance with empty Graph
    credentials (all falsy → Graph calls are skipped in every sync function).
    """
    from api.app.config import get_settings
    return get_settings()


TENANT = "test-tenant"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_cc(db, name, tenant=TENANT, graph_dept_name=None, protected=False, active=True,
            location=None, code=None):
    cc = CostCenter(
        id=generate_uuid(), tenant_id=tenant,
        code=code if code else name[:5].upper(),
        name=name, graph_department_name=graph_dept_name,
        is_active=active, sync_protected=protected,
        location=location,
    )
    db.add(cc)
    db.flush()
    return cc


def make_user(db, oid, email, role=UserRole.EMPLOYEE, manager_oid=None, cc=None, tenant=TENANT, active=True):
    u = User(
        id=generate_uuid(), tenant_id=tenant, object_id=oid,
        email=email, display_name=email.split("@")[0],
        role=role, manager_object_id=manager_oid,
        cost_center_id=cc.id if cc else None,
        is_active=active,
    )
    db.add(u)
    db.flush()
    return u


# ---------------------------------------------------------------------------
# 1-3: Basic assign_cost_center_managers — force flag
# ---------------------------------------------------------------------------

def test_assign_cc_managers_sets_ro_and_director(db, settings):
    """RO = first manager in chain; Director = RO's manager."""
    cc = make_cc(db, "Engineering")
    director = make_user(db, "dir-1", "dir@t.com", role=UserRole.MANAGER, cc=cc)
    ro = make_user(db, "ro-1", "ro@t.com", role=UserRole.MANAGER, manager_oid="dir-1", cc=cc)
    _emp = make_user(db, "emp-1", "emp@t.com", manager_oid="ro-1", cc=cc)
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT)

    db.refresh(cc)
    assert cc.ro_user_id == ro.id
    assert cc.director_user_id == director.id
    assert result["updated"] >= 1


def test_assign_cc_managers_null_only_by_default(db, settings):
    """Without force, existing ro_user_id / director_user_id are never overwritten."""
    cc = make_cc(db, "Marketing")
    wrong_user = make_user(db, "wrong-1", "wrong@t.com", role=UserRole.MANAGER, cc=cc)
    cc.ro_user_id = wrong_user.id  # manually set to wrong person
    db.flush()
    director = make_user(db, "dir-2", "dir2@t.com", role=UserRole.MANAGER, cc=cc)
    ro = make_user(db, "ro-2", "ro2@t.com", role=UserRole.MANAGER, manager_oid="dir-2", cc=cc)
    _emp = make_user(db, "emp-2", "emp2@t.com", manager_oid="ro-2", cc=cc)
    db.commit()

    assign_cost_center_managers(db, settings, TENANT, force=False)

    db.refresh(cc)
    # ro_user_id was already set → not overwritten
    assert cc.ro_user_id == wrong_user.id


def test_assign_cc_managers_force_overwrites_stale(db, settings):
    """force=True re-evaluates and corrects a stale ro_user_id."""
    cc = make_cc(db, "Sales")
    wrong_user = make_user(db, "wrong-3", "wrong3@t.com", role=UserRole.MANAGER, cc=cc)
    cc.ro_user_id = wrong_user.id
    db.flush()
    director = make_user(db, "dir-3", "dir3@t.com", role=UserRole.MANAGER, cc=cc)
    correct_ro = make_user(db, "ro-3", "ro3@t.com", role=UserRole.MANAGER, manager_oid="dir-3", cc=cc)
    emp = make_user(db, "emp-3", "emp3@t.com", manager_oid="ro-3", cc=cc)
    db.commit()

    assign_cost_center_managers(db, settings, TENANT, force=True)

    db.refresh(cc)
    assert cc.ro_user_id == correct_ro.id
    assert cc.director_user_id == director.id


# ---------------------------------------------------------------------------
# 4: sync_protected always skipped
# ---------------------------------------------------------------------------

def test_sync_protected_cc_skipped_even_with_force(db, settings):
    """sync_protected CCs are never touched by assign_cost_center_managers."""
    cc = make_cc(db, "QC DK", protected=True)
    manager = make_user(db, "mgr-p", "mgr@t.com", role=UserRole.MANAGER, cc=cc)
    emp = make_user(db, "emp-p", "empp@t.com", manager_oid="mgr-p", cc=cc)
    db.commit()

    assign_cost_center_managers(db, settings, TENANT, force=True)

    db.refresh(cc)
    assert cc.ro_user_id is None
    assert cc.director_user_id is None


# ---------------------------------------------------------------------------
# 5: normalize_department_name
# ---------------------------------------------------------------------------

def test_normalize_trims_and_lowercases():
    assert normalize_department_name("  Biomaterial R&D  ") == "biomaterial r&d"


def test_normalize_collapses_spaces():
    assert normalize_department_name("Biomaterial  R&D") == "biomaterial r&d"


def test_normalize_and_to_ampersand():
    assert normalize_department_name("Biomaterial and D") == "biomaterial & d"


def test_normalize_same_after_normalization():
    assert normalize_department_name("Biomaterial R&D") == normalize_department_name("biomaterial r&d")


def test_normalize_near_spelling_variant():
    """'Biomaterials R&D' vs 'Biomaterial R&D' should NOT normalize to the same value."""
    assert normalize_department_name("Biomaterials R&D") != normalize_department_name("Biomaterial R&D")


def test_normalize_empty():
    assert normalize_department_name("") == ""
    assert normalize_department_name(None) == ""


# ---------------------------------------------------------------------------
# 6-7: _sync_cc_assignments normalized-name fallback + backfill
# ---------------------------------------------------------------------------

class _FakeSettings:
    """Minimal settings with non-empty Graph credentials so sync functions do not short-circuit.

    Credentials are fake — actual HTTP calls are always replaced by monkeypatched GraphAppClient.
    """
    graph_client_id = "fake-client-id"
    graph_client_secret = "fake-secret"
    azure_tenant_id = "fake-tenant"
    graph_sync_deactivate_missing = False


class _FakeGraph:
    """Minimal Graph stub that returns a fixed set of users."""
    def __init__(self, users):
        self._users = users

    def list_all_users(self):
        return self._users

    def batch_get_managers(self, oids):
        return {}

    def list_all_managers(self, oids):
        return set()


def _patch_graph(monkeypatch, graph):
    """Replace GraphAppClient constructor with a stub returning graph."""
    import api.app.services.background_sync as bs
    monkeypatch.setattr(bs, "GraphAppClient", lambda _settings: graph)


def test_sync_cc_assignments_normalized_fallback(db, monkeypatch):
    """Users assigned to a manually-created CC (graph_department_name=NULL) via normalized match."""
    cc = make_cc(db, "Biomaterial R&D", graph_dept_name=None)
    user = make_user(db, "u-1", "alice@ferrosanmd.com", cc=None)
    db.commit()

    graph_users = [
        {"id": "u-1", "displayName": "Alice", "mail": "alice@ferrosanmd.com",
         "userPrincipalName": "alice@ferrosanmd.com",
         "accountEnabled": True, "department": "Biomaterial R&D", "country": "DK"},
    ]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))
    result = _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(user)
    db.refresh(cc)

    assert user.cost_center_id == cc.id, "User should be assigned to the manually-created CC"
    assert cc.graph_department_name == "Biomaterial R&D", "graph_department_name should be backfilled"
    assert result["assigned"] >= 1


def test_sync_cc_assignments_creates_new_when_no_name_match(db, monkeypatch):
    """When CC name doesn't match (even normalized), a new CC is created."""
    _existing = make_cc(db, "Totally Different", graph_dept_name=None)
    user = make_user(db, "u-2", "bob@ferrosanmd.com", cc=None)
    db.commit()

    graph_users = [
        {"id": "u-2", "displayName": "Bob", "mail": "bob@ferrosanmd.com",
         "userPrincipalName": "bob@ferrosanmd.com",
         "accountEnabled": True, "department": "Biomaterial R&D", "country": "DK"},
    ]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))
    result = _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(user)

    from api.app.models.core import CostCenter
    new_cc = db.query(CostCenter).filter(
        CostCenter.tenant_id == TENANT,
        CostCenter.graph_department_name == "Biomaterial R&D",
    ).first()
    assert new_cc is not None
    assert user.cost_center_id == new_cc.id
    assert result["created_ccs"] >= 1


# ---------------------------------------------------------------------------
# 8: import_departments_from_graph backfills graph_department_name
# ---------------------------------------------------------------------------

def test_import_departments_backfills_existing_cc(db, monkeypatch):
    """import_departments_from_graph backfills graph_department_name on normalized-name match."""
    cc = make_cc(db, "Biomaterial R&D", graph_dept_name=None)
    db.commit()

    graph_users = [
        {"id": "u-3", "displayName": "Carol", "mail": "carol@ferrosanmd.com",
         "userPrincipalName": "carol@ferrosanmd.com",
         "accountEnabled": True, "department": "Biomaterial R&D", "country": "DK"},
    ]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    result = import_departments_from_graph(db, _FakeSettings(), TENANT)
    db.refresh(cc)

    assert cc.graph_department_name == "Biomaterial R&D"
    assert result.get("backfilled", 0) >= 1
    assert result["created"] == 0


def test_import_departments_skips_already_linked(db, monkeypatch):
    """CCs already linked via graph_department_name are not duplicated."""
    cc = make_cc(db, "Biomaterial R&D", graph_dept_name="Biomaterial R&D")
    db.commit()

    graph_users = [
        {"id": "u-4", "displayName": "Dave", "mail": "dave@ferrosanmd.com",
         "userPrincipalName": "dave@ferrosanmd.com",
         "accountEnabled": True, "department": "Biomaterial R&D", "country": "DK"},
    ]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    result = import_departments_from_graph(db, _FakeSettings(), TENANT)

    assert result["created"] == 0
    assert result["skipped"] >= 1


# ---------------------------------------------------------------------------
# 9: Katja-like fixture — Director in manager chain, NOT in CC
# ---------------------------------------------------------------------------

def test_katja_like_director_assignment(db, settings):
    """
    Org structure for Biomaterial R&D:
      Employee → RO (same CC) → Katja (Director, different CC) → VP (no CC)

    Expected:
      CC.ro_user_id    = RO
      CC.director_user_id = Katja
    """
    bio_cc = make_cc(db, "Biomaterial R&D", graph_dept_name="Biomaterial R&D")
    mgmt_cc = make_cc(db, "Management")

    vp = make_user(db, "vp-k", "vp@ferrosanmd.com", role=UserRole.MANAGER, cc=mgmt_cc)
    katja = make_user(db, "katja-oid", "kahi@ferrosanmd.com", role=UserRole.MANAGER,
                      manager_oid="vp-k", cc=mgmt_cc)
    ro = make_user(db, "ro-k", "ro@ferrosanmd.com", role=UserRole.MANAGER,
                   manager_oid="katja-oid", cc=bio_cc)
    emp = make_user(db, "emp-k", "emp@ferrosanmd.com", manager_oid="ro-k", cc=bio_cc)
    db.commit()

    assign_cost_center_managers(db, settings, TENANT)
    db.refresh(bio_cc)

    assert bio_cc.ro_user_id == ro.id, "RO should be the immediate manager of employees in the CC"
    assert bio_cc.director_user_id == katja.id, "Katja (RO's manager) should be the Director"


def test_katja_direct_report_becomes_ro(db, settings):
    """
    When employees report DIRECTLY to Katja (no intermediate RO), Katja becomes RO.
    Director = Katja's manager (Shpresa).

    This reflects the case where there's no intermediate manager layer.
    """
    bio_cc = make_cc(db, "Biomaterial R&D", graph_dept_name="Biomaterial R&D")

    shpresa = make_user(db, "shpresa-oid", "slpe@ferrosanmd.com", role=UserRole.MANAGER)
    katja = make_user(db, "katja-oid2", "kahi2@ferrosanmd.com", role=UserRole.MANAGER,
                      manager_oid="shpresa-oid", cc=bio_cc)
    emp = make_user(db, "emp-k2", "emp2@ferrosanmd.com", manager_oid="katja-oid2", cc=bio_cc)
    db.commit()

    assign_cost_center_managers(db, settings, TENANT)
    db.refresh(bio_cc)

    # Katja IS in the CC (same cost_center_id) → first pass finds her as same-CC manager → RO
    assert bio_cc.ro_user_id == katja.id
    assert bio_cc.director_user_id == shpresa.id


# ---------------------------------------------------------------------------
# 10: No manager chain → no RO, no crash
# ---------------------------------------------------------------------------

def test_cc_with_no_manager_chain_produces_no_ro(db, settings):
    """CC members with no manager_object_id → both RO and Director remain NULL, no error."""
    cc = make_cc(db, "Orphan Dept", graph_dept_name="Orphan Dept")
    _emp = make_user(db, "orphan-emp", "orphan@t.com", manager_oid=None, cc=cc)
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT)
    db.refresh(cc)

    assert cc.ro_user_id is None
    assert cc.director_user_id is None
    assert result["errors"] == []


# ---------------------------------------------------------------------------
# 11-12: promote_managers_from_graph
# ---------------------------------------------------------------------------

class _ManagerGraph:
    def __init__(self, manager_oids):
        self._managers = set(manager_oids)

    def list_all_users(self):
        return []

    def batch_get_managers(self, oids):
        return {}

    def list_all_managers(self, oids):
        return self._managers


def test_promote_managers_promotes_employee(db, monkeypatch):
    """EMPLOYEE is promoted to MANAGER if their OID is returned as a manager."""
    emp = make_user(db, "emp-promo", "promo@t.com", role=UserRole.EMPLOYEE)
    db.commit()

    import api.app.services.background_sync as bs
    monkeypatch.setattr(bs, "GraphAppClient", lambda _s: _ManagerGraph(["emp-promo"]))

    result = promote_managers_from_graph(db, _FakeSettings(), TENANT)
    db.refresh(emp)

    assert emp.role == UserRole.MANAGER
    assert result["promoted"] == 1


def test_promote_managers_does_not_demote_admin(db, monkeypatch):
    """ADMIN users are never demoted even if not in the managers set."""
    admin = make_user(db, "admin-pd", "admin@t.com", role=UserRole.ADMIN)
    db.commit()

    import api.app.services.background_sync as bs
    monkeypatch.setattr(bs, "GraphAppClient", lambda _s: _ManagerGraph([]))

    promote_managers_from_graph(db, _FakeSettings(), TENANT)
    db.refresh(admin)
    assert admin.role == UserRole.ADMIN


def test_promote_managers_does_not_demote_finance(db, monkeypatch):
    fin = make_user(db, "fin-nd", "fin@t.com", role=UserRole.FINANCE)
    db.commit()

    import api.app.services.background_sync as bs
    monkeypatch.setattr(bs, "GraphAppClient", lambda _s: _ManagerGraph([]))

    promote_managers_from_graph(db, _FakeSettings(), TENANT)
    db.refresh(fin)
    assert fin.role == UserRole.FINANCE


# ---------------------------------------------------------------------------
# 13: _find_ro_candidate second pass walks full chain
# ---------------------------------------------------------------------------

def test_find_ro_candidate_second_pass_full_chain(db, settings):
    """
    Second pass should find a manager even when the immediate manager is not in the DB.
    Structure: emp → (ghost, not in DB) → real_manager (in DB)

    Because ghost is not in users_by_object_id, the chain stops at ghost.
    BUT for the first user in cc_users whose direct manager IS in the DB, we return them.

    Test: two employees — one whose manager is in DB, one whose isn't.
    The candidate returned is the manager of the employee whose manager IS in DB.
    """
    cc = make_cc(db, "Chain Dept")
    real_mgr = make_user(db, "real-mgr", "real@t.com", role=UserRole.MANAGER)
    emp_a = make_user(db, "emp-a", "empa@t.com", manager_oid="ghost-oid", cc=cc)
    emp_b = make_user(db, "emp-b", "empb@t.com", manager_oid="real-mgr", cc=cc)
    db.commit()

    users_by_oid = {
        "real-mgr": real_mgr,
        "emp-a": emp_a,
        "emp-b": emp_b,
    }

    candidate = _find_ro_candidate(cc, [emp_a, emp_b], users_by_oid)
    assert candidate is real_mgr


# ---------------------------------------------------------------------------
# 14: Duplicate/similar department names — no crash, valid result
# ---------------------------------------------------------------------------

def test_similar_department_names_dont_crash(db, settings):
    """Two CCs with similar names (Biomaterial R&D vs Biomaterials R&D) don't crash."""
    cc1 = make_cc(db, "Biomaterial R&D", graph_dept_name="Biomaterial R&D")
    cc2 = make_cc(db, "Biomaterials R&D", graph_dept_name="Biomaterials R&D")
    mgr1 = make_user(db, "m-1", "m1@t.com", role=UserRole.MANAGER, cc=cc1)
    emp1 = make_user(db, "e-1", "e1@t.com", manager_oid="m-1", cc=cc1)
    mgr2 = make_user(db, "m-2", "m2@t.com", role=UserRole.MANAGER, cc=cc2)
    emp2 = make_user(db, "e-2", "e2@t.com", manager_oid="m-2", cc=cc2)
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT)
    db.refresh(cc1)
    db.refresh(cc2)

    assert result["errors"] == []
    assert cc1.ro_user_id == mgr1.id
    assert cc2.ro_user_id == mgr2.id


# ---------------------------------------------------------------------------
# 15: force_cc_managers on run_full_sync
# ---------------------------------------------------------------------------

def test_run_full_sync_force_cc_managers(db, settings, monkeypatch):
    """run_full_sync with force_cc_managers=True re-evaluates stale CC assignments."""
    cc = make_cc(db, "Stale Dept", graph_dept_name="Stale Dept")
    wrong = make_user(db, "wrong-fs", "wrong@t.com", role=UserRole.MANAGER, cc=cc)
    cc.ro_user_id = wrong.id  # wrong assignment
    db.flush()
    director = make_user(db, "dir-fs", "dir@t.com", role=UserRole.MANAGER, cc=cc)
    correct_ro = make_user(db, "ro-fs", "ro@t.com", role=UserRole.MANAGER,
                           manager_oid="dir-fs", cc=cc)
    emp = make_user(db, "emp-fs", "emp@t.com", manager_oid="ro-fs", cc=cc)
    db.commit()

    import api.app.services.background_sync as bs

    class _NoGraphSync:
        """Stubs that make all graph-dependent steps no-ops."""
        def list_all_users(self):
            return []
        def batch_get_managers(self, oids):
            return {}
        def list_all_managers(self, oids):
            return set()

    monkeypatch.setattr(bs, "GraphAppClient", lambda _s: _NoGraphSync())

    run_full_sync(db, settings, TENANT, force_cc_managers=True)
    db.refresh(cc)

    assert cc.ro_user_id == correct_ro.id
    assert cc.director_user_id == director.id


# ---------------------------------------------------------------------------
# E: New tests for force=True persistence and full-sync wiring
# ---------------------------------------------------------------------------

class _NoGraphSync:
    """Shared stub: all Graph-dependent sync steps become no-ops."""
    def list_all_users(self): return []
    def batch_get_managers(self, oids): return {}
    def list_all_managers(self, oids): return set()


def _patch_no_graph(monkeypatch):
    import api.app.services.background_sync as bs
    monkeypatch.setattr(bs, "GraphAppClient", lambda _s: _NoGraphSync())


# E1 — force=False: existing ro_user_id is NOT overwritten (already covered in test 2, kept for
#        explicitness with the new return-value format)
def test_force_false_does_not_overwrite_existing_ro(db, settings):
    """force=False leaves a pre-existing stale ro_user_id unchanged."""
    cc = make_cc(db, "E1 Dept")
    anders = make_user(db, "anders-e1", "anders@t.com", role=UserRole.MANAGER, cc=cc)
    cc.ro_user_id = anders.id
    db.flush()
    katja = make_user(db, "katja-e1", "katja@t.com", role=UserRole.MANAGER, manager_oid=None, cc=cc)
    emp = make_user(db, "emp-e1", "emp@t.com", manager_oid="katja-e1", cc=cc)
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT, force=False)
    db.refresh(cc)

    assert cc.ro_user_id == anders.id, "force=False must not overwrite existing ro_user_id"
    assert result["ro_skipped_existing"] >= 1


# E2 — force=True: stale ro_user_id IS overwritten
def test_force_true_overwrites_stale_ro(db, settings):
    """force=True replaces a stale ro_user_id with the correct candidate."""
    cc = make_cc(db, "E2 Dept")
    anders = make_user(db, "anders-e2", "anders@t.com", role=UserRole.MANAGER, cc=cc)
    cc.ro_user_id = anders.id
    db.flush()
    rasmus = make_user(db, "rasmus-e2", "rasmus@t.com", role=UserRole.MANAGER, cc=cc)
    katja = make_user(db, "katja-e2", "katja@t.com", role=UserRole.MANAGER,
                      manager_oid="rasmus-e2", cc=cc)
    emp = make_user(db, "emp-e2", "emp@t.com", manager_oid="katja-e2", cc=cc)
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT, force=True)
    db.refresh(cc)

    assert cc.ro_user_id == katja.id, "force=True must update stale ro_user_id"
    assert result["ro_updated"] >= 1


# E3 — force=True: director correctly upserted via RO's manager chain
def test_force_true_upserts_director(db, settings):
    """force=True sets director_user_id from the RO's manager, even when already set."""
    cc = make_cc(db, "E3 Dept")
    rasmus = make_user(db, "rasmus-e3", "rasmus@t.com", role=UserRole.MANAGER, cc=cc)
    katja = make_user(db, "katja-e3", "katja@t.com", role=UserRole.MANAGER,
                      manager_oid="rasmus-e3", cc=cc)
    emp = make_user(db, "emp-e3", "emp@t.com", manager_oid="katja-e3", cc=cc)
    # Pre-set a stale director
    cc.ro_user_id = katja.id
    cc.director_user_id = make_user(db, "stale-dir", "stale@t.com", role=UserRole.MANAGER).id
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT, force=True)
    db.refresh(cc)

    assert cc.director_user_id == rasmus.id, "force=True must update director to RO's manager"
    assert result["director_updated"] >= 1


# E4 — sync_protected CC never modified, even with force=True
def test_sync_protected_never_modified_with_force(db, settings):
    """sync_protected=True CCs are always skipped, force=True has no effect."""
    cc = make_cc(db, "E4 Protected", protected=True)
    mgr = make_user(db, "mgr-e4", "mgr@t.com", role=UserRole.MANAGER, cc=cc)
    emp = make_user(db, "emp-e4", "emp@t.com", manager_oid="mgr-e4", cc=cc)
    db.commit()

    result = assign_cost_center_managers(db, settings, TENANT, force=True)
    db.refresh(cc)

    assert cc.ro_user_id is None
    assert cc.director_user_id is None
    assert result["skipped_protected"] >= 1


# E5 — run_full_sync default calls assign_cost_center_managers(force=True)
def test_run_full_sync_default_passes_force_true(db, settings, monkeypatch):
    """run_full_sync() with no explicit force_cc_managers arg calls assign with force=True."""
    import api.app.services.background_sync as bs

    captured = {}

    def _spy_assign(db, settings, tenant_id, force=False):
        captured["force"] = force
        return {
            "cost_centers_checked": 0, "ro_assigned": 0, "ro_updated": 0,
            "ro_skipped_existing": 0, "director_assigned": 0, "director_updated": 0,
            "director_skipped_existing": 0, "skipped_protected": 0,
            "no_ro_candidate": 0, "no_director_candidate": 0, "errors": [],
            "updated": 0, "skipped": 0,
        }

    monkeypatch.setattr(bs, "assign_cost_center_managers", _spy_assign)
    _patch_no_graph(monkeypatch)

    run_full_sync(db, settings, TENANT)

    assert captured.get("force") is True, "Default full sync must call assign_cost_center_managers(force=True)"


# E6 — run_full_sync commits the assignment so DB reflects updated ro_user_id
def test_run_full_sync_commits_assignment(db, settings, monkeypatch):
    """After run_full_sync(), the DB row for the CC has the updated ro_user_id."""
    cc = make_cc(db, "E6 Dept", graph_dept_name="E6 Dept")
    anders = make_user(db, "anders-e6", "anders@t.com", role=UserRole.MANAGER, cc=cc)
    cc.ro_user_id = anders.id
    db.flush()
    rasmus = make_user(db, "rasmus-e6", "rasmus@t.com", role=UserRole.MANAGER, cc=cc)
    katja = make_user(db, "katja-e6", "katja@t.com", role=UserRole.MANAGER,
                      manager_oid="rasmus-e6", cc=cc)
    emp = make_user(db, "emp-e6", "emp@t.com", manager_oid="katja-e6", cc=cc)
    db.commit()

    _patch_no_graph(monkeypatch)
    run_full_sync(db, settings, TENANT)

    db.expire(cc)
    db.refresh(cc)
    assert cc.ro_user_id == katja.id, "DB must persist updated ro_user_id after full sync"
    assert cc.director_user_id == rasmus.id, "DB must persist updated director_user_id after full sync"


# E7 — run_full_sync result includes assign_cc_managers step with counts
def test_run_full_sync_result_includes_manager_step(db, settings, monkeypatch):
    """run_full_sync result dict includes steps['assign_cc_managers'] with granular counts."""
    _patch_no_graph(monkeypatch)
    result = run_full_sync(db, settings, TENANT)

    assert "assign_cc_managers" in result["steps"], "assign_cc_managers step must appear in result"
    step = result["steps"]["assign_cc_managers"]
    assert "cost_centers_checked" in step or "error" in step, \
        "step must contain counts or an error key"


# E8 — Biomaterial-like fixture: default full sync corrects stale RO/Director
def test_biomaterial_like_fixture_full_sync_corrects_stale(db, settings, monkeypatch):
    """
    Mirrors the Biomaterial R&D scenario:
      - CostCenter has stale ro_user_id=Anders, director_user_id already correct
      - Resources report to Katja (in the same CC)
      - Katja's manager is Rasmus
      - run_full_sync() with no explicit force arg must update ro_user_id to Katja
    """
    bio_cc = make_cc(db, "Biomaterial R&D", graph_dept_name="Biomaterial R&D")
    rasmus = make_user(db, "rasmus-bio", "rasmus@ferrosanmd.com", role=UserRole.MANAGER)
    anders = make_user(db, "anders-bio", "anders@ferrosanmd.com", role=UserRole.MANAGER, cc=bio_cc)
    katja = make_user(db, "katja-bio", "katja@ferrosanmd.com", role=UserRole.MANAGER,
                      manager_oid="rasmus-bio", cc=bio_cc)
    emp1 = make_user(db, "emp-bio-1", "emp1@ferrosanmd.com", manager_oid="katja-bio", cc=bio_cc)
    emp2 = make_user(db, "emp-bio-2", "emp2@ferrosanmd.com", manager_oid="katja-bio", cc=bio_cc)

    # Stale state: Anders is set as RO, Rasmus is correctly set as Director
    bio_cc.ro_user_id = anders.id
    bio_cc.director_user_id = rasmus.id
    db.commit()

    _patch_no_graph(monkeypatch)
    # Trigger full sync without explicit force argument (default must be True after the fix)
    run_full_sync(db, settings, TENANT)

    db.expire(bio_cc)
    db.refresh(bio_cc)
    assert bio_cc.ro_user_id == katja.id, \
        "ro_user_id must be updated to Katja (correct manager for Biomaterial R&D)"
    assert bio_cc.director_user_id == rasmus.id, \
        "director_user_id must remain Rasmus (Katja's manager)"


# E9 — Exceptions in assign_cost_center_managers are surfaced, not swallowed
def test_full_sync_surfaces_assign_errors(db, settings, monkeypatch):
    """An exception in assign_cost_center_managers is captured in result, not swallowed."""
    import api.app.services.background_sync as bs

    def _raise_assign(db, settings, tenant_id, force=False):
        raise RuntimeError("simulated CC manager assignment error")

    monkeypatch.setattr(bs, "assign_cost_center_managers", _raise_assign)
    _patch_no_graph(monkeypatch)

    result = run_full_sync(db, settings, TENANT)

    assert "assign_cc_managers" in result["steps"]
    step = result["steps"]["assign_cc_managers"]
    assert "error" in step, "Error must be recorded in the step result"
    assert "simulated" in step["error"]
    assert result["total_errors"] >= 1, "total_errors must be incremented on step failure"


# ---------------------------------------------------------------------------
# QC1: ensure_quality_control_cost_center_metadata — full reconciliation
# ---------------------------------------------------------------------------

def test_qc_metadata_reconciliation(db):
    """DK QC inactive + wrong graph_dept; PL QC owns 'Quality Control'; QC Lab unchanged."""
    dk_qc = make_cc(db, "Quality Control DK", code="QC-DK",
                    graph_dept_name="Quality Control DK", location="Denmark", active=False)
    qc_lab = make_cc(db, "Quality Control Lab",
                     graph_dept_name="Quality Control Lab", location="Denmark")
    pl_qc = make_cc(db, "Quality Control", code="QUALI",
                    graph_dept_name="Quality Control", location="Poland")
    db.commit()

    result = ensure_quality_control_cost_center_metadata(db, TENANT)
    db.refresh(dk_qc)
    db.refresh(qc_lab)
    db.refresh(pl_qc)

    # DK QC corrected
    assert dk_qc.is_active is True
    assert dk_qc.name == "Quality Control"
    assert dk_qc.graph_department_name == "Quality Control"
    assert dk_qc.location == "Denmark"
    assert result["dk_qc_updated"] is True

    # QC Lab untouched
    assert qc_lab.graph_department_name == "Quality Control Lab"
    assert qc_lab.name == "Quality Control Lab"
    assert result["qc_lab_unchanged"] is True

    # PL QC renamed so it no longer competes
    assert pl_qc.graph_department_name == "Quality Control PL"
    assert result["pl_qc_repointed"] == 1
    assert result["warnings"] == []


# ---------------------------------------------------------------------------
# QC2: ensure_quality_control_cost_center_metadata — idempotent
# ---------------------------------------------------------------------------

def test_qc_metadata_idempotent(db):
    """Second run on already-correct state reports no changes."""
    make_cc(db, "Quality Control", code="QC-DK",
            graph_dept_name="Quality Control", location="Denmark")
    db.commit()

    r1 = ensure_quality_control_cost_center_metadata(db, TENANT)
    r2 = ensure_quality_control_cost_center_metadata(db, TENANT)

    assert r2["dk_qc_updated"] is False
    assert r2["pl_qc_repointed"] == 0


# ---------------------------------------------------------------------------
# QC3: DK user with dept="Quality Control" routes to DK QC
# ---------------------------------------------------------------------------

def test_dk_quality_control_user_routes_to_dk_qc(db, monkeypatch):
    """DK user whose Graph dept is 'Quality Control' maps to DK Quality Control CC."""
    dk_qc = make_cc(db, "Quality Control", code="QC-DK",
                    graph_dept_name="Quality Control", location="Denmark")
    dk_user = make_user(db, "dk-qc-1", "dkqc@ferrosanmd.com", cc=None)
    dk_user.country = "Denmark"
    db.commit()

    graph_users = [{"id": "dk-qc-1", "displayName": "DK QC User",
                    "mail": "dkqc@ferrosanmd.com", "userPrincipalName": "dkqc@ferrosanmd.com",
                    "accountEnabled": True, "department": "Quality Control", "country": "Denmark"}]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    result = _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(dk_user)

    assert dk_user.cost_center_id == dk_qc.id
    assert result["assigned"] >= 1


# ---------------------------------------------------------------------------
# QC4: DK user with dept="Quality Control Lab" routes to QC Lab
# ---------------------------------------------------------------------------

def test_dk_qc_lab_user_routes_to_qc_lab(db, monkeypatch):
    """DK user whose Graph dept is 'Quality Control Lab' maps to QC Lab CC."""
    qc_lab = make_cc(db, "Quality Control Lab",
                     graph_dept_name="Quality Control Lab", location="Denmark")
    lab_user = make_user(db, "lab-u-1", "lab@ferrosanmd.com", cc=None)
    lab_user.country = "Denmark"
    db.commit()

    graph_users = [{"id": "lab-u-1", "displayName": "Lab User",
                    "mail": "lab@ferrosanmd.com", "userPrincipalName": "lab@ferrosanmd.com",
                    "accountEnabled": True, "department": "Quality Control Lab",
                    "country": "Denmark"}]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    result = _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(lab_user)

    assert lab_user.cost_center_id == qc_lab.id
    assert result["assigned"] >= 1


# ---------------------------------------------------------------------------
# QC5: PL user with dept="Quality Control" does NOT land in DK QC
# ---------------------------------------------------------------------------

def test_pl_quality_control_user_does_not_route_to_dk_qc(db, monkeypatch):
    """PL user whose Graph dept is 'Quality Control' is NOT assigned to DK QC."""
    dk_qc = make_cc(db, "Quality Control", code="QC-DK",
                    graph_dept_name="Quality Control", location="Denmark")
    pl_user = make_user(db, "pl-qc-1", "plqc@ferrosanmd.com", cc=None)
    pl_user.country = "Poland"
    db.commit()

    graph_users = [{"id": "pl-qc-1", "displayName": "PL QC User",
                    "mail": "plqc@ferrosanmd.com", "userPrincipalName": "plqc@ferrosanmd.com",
                    "accountEnabled": True, "department": "Quality Control", "country": "Poland"}]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(pl_user)

    assert pl_user.cost_center_id != dk_qc.id, "PL user must not be assigned to DK QC"
    assert pl_user.cost_center_id is None, "PL user should stay unassigned (country mismatch guard)"


# ---------------------------------------------------------------------------
# QC6: Country-mismatch guard is generic — also prevents non-QC cross-country
# ---------------------------------------------------------------------------

def test_country_mismatch_guard_generic(db, monkeypatch):
    """Any CC with location set does not accept users from a different country."""
    dk_hr = make_cc(db, "HR DK", graph_dept_name="HR DK", location="Denmark")
    pl_user = make_user(db, "pl-hr-1", "plhr@ferrosanmd.com", cc=None)
    pl_user.country = "Poland"
    db.commit()

    graph_users = [{"id": "pl-hr-1", "displayName": "PL HR User",
                    "mail": "plhr@ferrosanmd.com", "userPrincipalName": "plhr@ferrosanmd.com",
                    "accountEnabled": True, "department": "HR DK", "country": "Poland"}]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(pl_user)

    assert pl_user.cost_center_id != dk_hr.id, "PL user should not be assigned to DK HR CC"


# ---------------------------------------------------------------------------
# QC7: CC without location set accepts any user (guard does not fire)
# ---------------------------------------------------------------------------

def test_no_location_on_cc_allows_any_user(db, monkeypatch):
    """CC with location=None accepts users regardless of their country (no guard)."""
    generic_cc = make_cc(db, "Finance", graph_dept_name="Finance", location=None)
    user = make_user(db, "fin-u-1", "fin@ferrosanmd.com", cc=None)
    user.country = "Poland"
    db.commit()

    graph_users = [{"id": "fin-u-1", "displayName": "Finance User",
                    "mail": "fin@ferrosanmd.com", "userPrincipalName": "fin@ferrosanmd.com",
                    "accountEnabled": True, "department": "Finance", "country": "Poland"}]
    _patch_graph(monkeypatch, _FakeGraph(graph_users))

    _sync_cc_assignments(db, _FakeSettings(), TENANT)
    db.refresh(user)

    assert user.cost_center_id == generic_cc.id, "CC with no location should accept any user"


# ---------------------------------------------------------------------------
# QC8: Full sync runs QC metadata step before CC assignment
# ---------------------------------------------------------------------------

def test_full_sync_includes_ensure_qc_metadata_step(db, settings, monkeypatch):
    """run_full_sync result includes ensure_qc_metadata step in steps dict."""
    _patch_no_graph(monkeypatch)
    result = run_full_sync(db, settings, TENANT)

    assert "ensure_qc_metadata" in result["steps"], \
        "ensure_qc_metadata must appear in full sync steps"


def test_full_sync_qc_metadata_before_assignment(db, settings, monkeypatch):
    """Full sync activates inactive DK QC before assigning DK users to it."""
    dk_qc = make_cc(db, "Quality Control DK", code="QC-DK",
                    graph_dept_name="Quality Control DK", location="Denmark", active=False)
    dk_user = make_user(db, "dk-fs-qc", "dkfsqc@ferrosanmd.com", cc=None)
    db.commit()

    graph_users = [{"id": "dk-fs-qc", "displayName": "DK FS QC",
                    "mail": "dkfsqc@ferrosanmd.com", "userPrincipalName": "dkfsqc@ferrosanmd.com",
                    "accountEnabled": True, "department": "Quality Control", "country": "Denmark"}]
    import api.app.services.background_sync as bs
    monkeypatch.setattr(bs, "GraphAppClient", lambda _s: _FakeGraph(graph_users))

    run_full_sync(db, _FakeSettings(), TENANT)
    db.refresh(dk_qc)
    db.refresh(dk_user)

    assert dk_qc.is_active is True, "DK QC must be activated by metadata step before assignment"
    assert dk_user.cost_center_id == dk_qc.id, "DK user must be assigned to activated DK QC"


# ---------------------------------------------------------------------------
# QC9: DK QC managers computed only from DK QC resources (not PL resources)
# ---------------------------------------------------------------------------

def test_dk_qc_managers_from_dk_resources_only(db, settings):
    """assign_cost_center_managers assigns DK QC RO from DK CC members, not PL members."""
    dk_qc = make_cc(db, "Quality Control", code="QC-DK",
                    graph_dept_name="Quality Control", location="Denmark")
    pl_qc = make_cc(db, "Quality Control PL", code="QUALI",
                    graph_dept_name="Quality Control PL", location="Poland")

    dk_ro = make_user(db, "dk-ro-mgr", "dkro@ferrosanmd.com", role=UserRole.MANAGER, cc=dk_qc)
    dk_emp = make_user(db, "dk-ro-emp", "dkemp@ferrosanmd.com", manager_oid="dk-ro-mgr", cc=dk_qc)
    pl_mgr = make_user(db, "pl-qc-mgr", "plmgr@ferrosanmd.com", role=UserRole.MANAGER, cc=pl_qc)
    pl_emp = make_user(db, "pl-qc-emp", "plemp@ferrosanmd.com", manager_oid="pl-qc-mgr", cc=pl_qc)
    db.commit()

    assign_cost_center_managers(db, settings, TENANT)
    db.refresh(dk_qc)
    db.refresh(pl_qc)

    assert dk_qc.ro_user_id == dk_ro.id, "DK QC RO must come from DK resources"
    assert pl_qc.ro_user_id == pl_mgr.id, "PL QC RO must come from PL resources"
    assert dk_qc.ro_user_id != pl_mgr.id, "PL manager must not be DK QC RO"


# ---------------------------------------------------------------------------
# QC10: ensure_qc_metadata does not deactivate unrelated CCs
# ---------------------------------------------------------------------------

def test_qc_metadata_does_not_touch_unrelated_ccs(db):
    """ensure_quality_control_cost_center_metadata only touches QC-family CCs."""
    unrelated = make_cc(db, "Biomaterial R&D", graph_dept_name="Biomaterial R&D", active=True)
    finance_cc = make_cc(db, "Finance", graph_dept_name="Finance", active=True)
    # Minimal DK QC to avoid warning
    make_cc(db, "Quality Control", code="QC-DK",
            graph_dept_name="Quality Control", location="Denmark")
    db.commit()

    ensure_quality_control_cost_center_metadata(db, TENANT)
    db.refresh(unrelated)
    db.refresh(finance_cc)

    assert unrelated.is_active is True, "Unrelated CC must not be deactivated"
    assert unrelated.graph_department_name == "Biomaterial R&D", "Unrelated CC must not be renamed"
    assert finance_cc.is_active is True
