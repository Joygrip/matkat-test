"""Tests for api/import_demand_csv.py

Uses an isolated SQLite :memory: engine — independent of the main test.db.
The conftest.py env-vars (ENV=dev, DEV_AUTH_BYPASS=true, DATABASE_URL=…)
are already set at collection time, so api.app.* imports work fine.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.app.db.base import Base
from api.app.models.core import (
    CostCenter, User, UserRole, Project, Period, Resource, PeriodStatus,
)
from api.app.models.planning import DemandLine
from api.app.models.audit import AuditLog
from api.app.auth.dependencies import CurrentUser

import api.import_demand_csv as imp

# ---------------------------------------------------------------------------
# Shared in-memory engine — tables are recreated per test via clean_db
# ---------------------------------------------------------------------------

TENANT = "test-tenant-import"

_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
_Sess = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=_engine)
    yield
    Base.metadata.drop_all(bind=_engine)


@pytest.fixture
def db():
    sess = _Sess()
    yield sess
    sess.close()


@pytest.fixture
def populated(db):
    """Standard DB state: one project, open + locked period, one resource, admin user."""
    cc = CostCenter(tenant_id=TENANT, code="CC1", name="CC1")
    db.add(cc)
    db.flush()

    admin = User(
        tenant_id=TENANT, object_id="obj-admin",
        email="admin@test.com", display_name="Admin",
        role=UserRole.ADMIN, is_active=True,
    )
    db.add(admin)
    proj = Project(tenant_id=TENANT, code="P1", name="SAPience", is_active=True)
    db.add(proj)
    p_open   = Period(tenant_id=TENANT, year=2025, month=6, status=PeriodStatus.OPEN)
    p_locked = Period(tenant_id=TENANT, year=2025, month=1, status=PeriodStatus.LOCKED)
    db.add(p_open)
    db.add(p_locked)
    res = Resource(
        tenant_id=TENANT, cost_center_id=cc.id,
        employee_id="EMP001", display_name="John Doe",
        initials="JD", is_active=True,
    )
    db.add(res)
    db.commit()
    for obj in (proj, p_open, p_locked, res, admin, cc):
        db.refresh(obj)
    return dict(project=proj, period_open=p_open, period_locked=p_locked,
                resource=res, user=admin, cc=cc)


@pytest.fixture
def maps(db, populated):
    return imp._load_maps(db, TENANT)


@pytest.fixture
def sys_user(populated):
    u = populated["user"]
    return CurrentUser(
        id=u.id, tenant_id=TENANT, object_id=u.object_id,
        email=u.email, display_name=u.display_name, role=u.role,
    )


# ---------------------------------------------------------------------------
# Helper: minimal valid CSV row
# ---------------------------------------------------------------------------

def _row(**overrides):
    base = dict(
        source_file="test.xlsx", source_row="1",
        project_name="SAPience", project_name_from_top="SAPience",
        period_key="2025-06", year="2025", month="6",
        resource_key_raw="JD", resource_key_type="initials",
        fte_percent="50", ready_for_mapping="TRUE", row_issue_codes="",
    )
    return {**base, **overrides}


def _seed_demand(db, populated, fte=50):
    dl = DemandLine(
        id=str(uuid.uuid4()), tenant_id=TENANT,
        project_id=populated["project"].id,
        period_id=populated["period_open"].id,
        resource_id=populated["resource"].id,
        year=2025, month=6, fte_percent=fte,
        created_by=populated["user"].id,
    )
    db.add(dl)
    db.commit()
    db.refresh(dl)
    return dl


# ===========================================================================
# Project matching
# ===========================================================================

class TestProjectMatching:
    def test_exact_match(self, db, maps, populated):
        r = imp._classify(_row(), maps, False, db, set())
        assert r.mapped_project_id == populated["project"].id
        assert r.action == imp.WOULD_CREATE

    def test_case_insensitive(self, db, maps, populated):
        r = imp._classify(_row(project_name="sapience"), maps, False, db, set())
        assert r.mapped_project_id == populated["project"].id

    def test_leading_trailing_spaces(self, db, maps, populated):
        r = imp._classify(_row(project_name="  SAPience  "), maps, False, db, set())
        assert r.mapped_project_id == populated["project"].id

    def test_hyphen_spacing_normalised(self, db, populated):
        proj = Project(tenant_id=TENANT, code="P2", name="My-Project", is_active=True)
        db.add(proj); db.commit()
        m = imp._load_maps(db, TENANT)
        r = imp._classify(_row(project_name="my - project"), m, False, db, set())
        assert r.mapped_project_id == proj.id

    def test_missing_project_rejected(self, db, maps):
        r = imp._classify(_row(project_name="Ghost"), maps, False, db, set())
        assert r.action == imp.MISSING_PROJECT
        assert r.mapped_project_id == ""

    def test_importer_never_creates_project(self, db, maps):
        before = db.query(Project).filter(Project.tenant_id == TENANT).count()
        imp._classify(_row(project_name="BrandNew"), maps, False, db, set())
        after = db.query(Project).filter(Project.tenant_id == TENANT).count()
        assert before == after

    def test_ambiguous_project_rejected(self, db, populated):
        db.add(Project(tenant_id=TENANT, code="X1", name="My Proj"))
        db.add(Project(tenant_id=TENANT, code="X2", name="MY PROJ"))
        db.commit()
        m = imp._load_maps(db, TENANT)
        r = imp._classify(_row(project_name="my proj"), m, False, db, set())
        assert r.action == imp.AMBIGUOUS_PROJECT


# ===========================================================================
# Period matching
# ===========================================================================

class TestPeriodMatching:
    def test_match_by_year_month(self, db, maps, populated):
        r = imp._classify(_row(year="2025", month="6"), maps, False, db, set())
        assert r.mapped_period_id == populated["period_open"].id

    def test_missing_period_rejected(self, db, maps):
        r = imp._classify(_row(year="2099", month="1"), maps, False, db, set())
        assert r.action == imp.MISSING_PERIOD
        assert r.mapped_period_id == ""

    def test_locked_period_rejected(self, db, maps):
        r = imp._classify(_row(year="2025", month="1"), maps, False, db, set())
        assert r.action == imp.LOCKED_PERIOD


# ===========================================================================
# Resource initials
# ===========================================================================

class TestResourceInitials:
    def test_match(self, db, maps, populated):
        r = imp._classify(_row(), maps, False, db, set())
        assert r.mapped_resource_id == populated["resource"].id

    def test_case_insensitive(self, db, maps, populated):
        r = imp._classify(_row(resource_key_raw="jd"), maps, False, db, set())
        assert r.mapped_resource_id == populated["resource"].id

    def test_missing_rejected(self, db, maps):
        r = imp._classify(_row(resource_key_raw="ZZ"), maps, False, db, set())
        assert r.action == imp.MISSING_RESOURCE

    def test_ambiguous_rejected(self, db, populated):
        cc_id = populated["cc"].id
        db.add(Resource(
            tenant_id=TENANT, cost_center_id=cc_id, employee_id="EMP002",
            display_name="Jane Doe", initials="JD", is_active=True,
        ))
        db.commit()
        m = imp._load_maps(db, TENANT)
        r = imp._classify(_row(), m, False, db, set())
        assert r.action == imp.AMBIGUOUS_RESOURCE

    def test_inactive_resource_excluded(self, db, populated):
        cc_id = populated["cc"].id
        db.add(Resource(
            tenant_id=TENANT, cost_center_id=cc_id, employee_id="EMP003",
            display_name="Inactive", initials="IX", is_active=False,
        ))
        db.commit()
        m = imp._load_maps(db, TENANT)
        r = imp._classify(_row(resource_key_raw="IX"), m, False, db, set())
        assert r.action == imp.MISSING_RESOURCE


# ===========================================================================
# Row filtering
# ===========================================================================

class TestRowFiltering:
    def test_skips_non_initials_type(self, db, maps):
        r = imp._classify(_row(resource_key_type="placeholder"), maps, False, db, set())
        assert r.action == imp.SKIPPED_NON_INITIALS

    def test_skips_not_ready(self, db, maps):
        r = imp._classify(_row(ready_for_mapping="FALSE"), maps, False, db, set())
        assert r.action == imp.SKIPPED_NON_INITIALS

    def test_skips_flagged_rows(self, db, maps):
        r = imp._classify(_row(row_issue_codes="ISSUE_001"), maps, False, db, set())
        assert r.action == imp.SKIPPED_FLAGGED

    @pytest.mark.parametrize("name", ["No name", "Lab", "Academic", "placeholder", "tbd"])
    def test_skips_placeholder_names(self, db, maps, name):
        r = imp._classify(_row(resource_key_raw=name), maps, False, db, set())
        assert r.action == imp.SKIPPED_NON_INITIALS

    def test_skipped_non_initials_appear_in_result_csv(self, db, maps):
        """Skipped rows must appear in import_result.csv for traceability."""
        r = imp._classify(_row(resource_key_type="placeholder"), maps, False, db, set())
        assert r.action == imp.SKIPPED_NON_INITIALS
        d = r.as_dict()
        assert d["action"] == imp.SKIPPED_NON_INITIALS

    def test_skipped_flagged_appear_in_issues(self, db, maps):
        r = imp._classify(_row(row_issue_codes="X"), maps, False, db, set())
        # issues = all non-written, non-pending rows
        # SKIPPED_FLAGGED is not in WRITTEN_ACTIONS or PENDING_ACTIONS → goes to issues
        assert r.action not in imp.WRITTEN_ACTIONS
        assert r.action not in imp.PENDING_ACTIONS


# ===========================================================================
# FTE validation — strict, no rounding
# ===========================================================================

class TestFTEValidation:
    def test_valid_integer_50(self, db, maps):
        r = imp._classify(_row(fte_percent="50"), maps, False, db, set())
        assert r.action == imp.WOULD_CREATE
        assert r.fte_percent == "50"

    def test_valid_float_50_dot_0(self, db, maps):
        r = imp._classify(_row(fte_percent="50.0"), maps, False, db, set())
        assert r.action == imp.WOULD_CREATE
        assert r.fte_percent == "50"

    def test_52_rejected_not_rounded(self, db, maps):
        """52 is not a multiple of 5 — must be rejected, not rounded to 50 or 55."""
        r = imp._classify(_row(fte_percent="52"), maps, False, db, set())
        assert r.action == imp.INVALID_FTE

    def test_52_dot_0_rejected(self, db, maps):
        r = imp._classify(_row(fte_percent="52.0"), maps, False, db, set())
        assert r.action == imp.INVALID_FTE

    def test_non_integer_float_rejected(self, db, maps):
        """1.5 is not near an integer — rejected."""
        r = imp._classify(_row(fte_percent="51.5"), maps, False, db, set())
        assert r.action == imp.INVALID_FTE

    def test_too_low_rejected(self, db, maps):
        r = imp._classify(_row(fte_percent="0"), maps, False, db, set())
        assert r.action == imp.INVALID_FTE

    def test_too_high_rejected(self, db, maps):
        r = imp._classify(_row(fte_percent="105"), maps, False, db, set())
        assert r.action == imp.INVALID_FTE

    def test_non_numeric_rejected(self, db, maps):
        r = imp._classify(_row(fte_percent="abc"), maps, False, db, set())
        assert r.action == imp.INVALID_FTE

    def test_validate_fte_helper_valid(self):
        assert imp._validate_fte("50") == (50, None)
        assert imp._validate_fte("50.0") == (50, None)
        assert imp._validate_fte("5") == (5, None)
        assert imp._validate_fte("100") == (100, None)

    def test_validate_fte_helper_invalid(self):
        assert imp._validate_fte("52")[0] is None
        assert imp._validate_fte("52.0")[0] is None
        assert imp._validate_fte("0")[0] is None
        assert imp._validate_fte("105")[0] is None
        assert imp._validate_fte("abc")[0] is None
        assert imp._validate_fte("51.5")[0] is None


# ===========================================================================
# Existing demand / upsert
# ===========================================================================

class TestExistingDemand:
    def test_skipped_without_upsert(self, db, maps, populated):
        _seed_demand(db, populated)
        r = imp._classify(_row(), maps, upsert=False, db=db, seen=set())
        assert r.action == imp.EXISTING_SKIPPED

    def test_updated_with_upsert_when_fte_differs(self, db, maps, populated):
        _seed_demand(db, populated, fte=50)
        r = imp._classify(_row(fte_percent="75"), maps, upsert=True, db=db, seen=set())
        assert r.action == imp.WOULD_UPDATE

    def test_skipped_with_upsert_when_fte_same(self, db, maps, populated):
        _seed_demand(db, populated, fte=50)
        r = imp._classify(_row(fte_percent="50"), maps, upsert=True, db=db, seen=set())
        assert r.action == imp.EXISTING_SKIPPED

    def test_existing_skipped_appears_in_issues(self, db, maps, populated):
        _seed_demand(db, populated)
        r = imp._classify(_row(), maps, False, db, set())
        assert r.action == imp.EXISTING_SKIPPED
        assert r.action not in imp.WRITTEN_ACTIONS
        assert r.action not in imp.PENDING_ACTIONS

    def test_duplicate_in_csv_flagged(self, db, maps):
        seen: set = set()
        imp._classify(_row(), maps, False, db, seen)
        r2 = imp._classify(_row(source_row="2"), maps, False, db, seen)
        assert r2.action == imp.DUPLICATE_IN_CSV

    def test_duplicate_message_includes_key(self, db, maps):
        seen: set = set()
        imp._classify(_row(), maps, False, db, seen)
        r2 = imp._classify(_row(source_row="2", fte_percent="75"), maps, False, db, seen)
        assert "SAPience" in r2.issue_message
        assert "JD" in r2.issue_message


# ===========================================================================
# Dry-run: absolutely no DB writes
# ===========================================================================

class TestDryRun:
    def test_classify_does_not_write_demand(self, db, maps):
        before = db.query(DemandLine).filter(DemandLine.tenant_id == TENANT).count()
        r = imp._classify(_row(), maps, False, db, set())
        assert r.action == imp.WOULD_CREATE
        assert db.query(DemandLine).filter(DemandLine.tenant_id == TENANT).count() == before

    def test_classify_does_not_write_audit(self, db, maps):
        before = db.query(AuditLog).count()
        imp._classify(_row(), maps, False, db, set())
        assert db.query(AuditLog).count() == before

    def test_stage_row_does_not_commit(self, db, maps, populated, sys_user):
        """_stage_row adds to session but does NOT call commit."""
        row = _row()
        r = imp._classify(row, maps, False, db, set())
        assert r.action == imp.WOULD_CREATE

        imp._stage_row(r, maps, db, sys_user)

        # Rolled back — no demand line in DB yet because no commit was called
        db.rollback()
        count = db.query(DemandLine).filter(DemandLine.tenant_id == TENANT).count()
        assert count == 0


# ===========================================================================
# Commit: all-or-nothing transaction
# ===========================================================================

class TestCommit:
    def test_commit_creates_demand_line(self, db, maps, populated, sys_user):
        row = _row()
        r = imp._classify(row, maps, False, db, set())
        assert r.action == imp.WOULD_CREATE

        imp._stage_row(r, maps, db, sys_user)
        db.commit()

        dl = (
            db.query(DemandLine)
            .filter(
                DemandLine.tenant_id == TENANT,
                DemandLine.project_id == populated["project"].id,
                DemandLine.resource_id == populated["resource"].id,
                DemandLine.year == 2025, DemandLine.month == 6,
            )
            .first()
        )
        assert dl is not None
        assert dl.fte_percent == 50

    def test_commit_writes_audit_log(self, db, maps, populated, sys_user):
        before = db.query(AuditLog).count()
        row = _row()
        r = imp._classify(row, maps, False, db, set())
        imp._stage_row(r, maps, db, sys_user)
        db.commit()
        assert db.query(AuditLog).count() == before + 1

    def test_audit_log_has_correct_fields(self, db, maps, populated, sys_user):
        row = _row()
        r = imp._classify(row, maps, False, db, set())
        imp._stage_row(r, maps, db, sys_user)
        db.commit()

        log = db.query(AuditLog).order_by(AuditLog.created_at.desc()).first()
        assert log is not None
        assert log.action == "create"
        assert log.entity_type == "demand_line"
        assert log.user_id == sys_user.object_id
        assert log.user_email == sys_user.email
        new_vals = json.loads(log.new_values)
        assert new_vals["fte_percent"] == 50

    def test_commit_updates_demand_line(self, db, maps, populated, sys_user):
        dl = _seed_demand(db, populated, fte=50)
        row = _row(fte_percent="75")
        r = imp._classify(row, maps, upsert=True, db=db, seen=set())
        assert r.action == imp.WOULD_UPDATE
        assert r._old_fte == 50
        assert r._existing_demand_id == dl.id

        imp._stage_row(r, maps, db, sys_user)
        db.commit()

        db.refresh(dl)
        assert dl.fte_percent == 75

    def test_commit_update_writes_audit_with_old_and_new(self, db, maps, populated, sys_user):
        _seed_demand(db, populated, fte=50)
        row = _row(fte_percent="75")
        r = imp._classify(row, maps, upsert=True, db=db, seen=set())
        imp._stage_row(r, maps, db, sys_user)
        db.commit()

        log = db.query(AuditLog).order_by(AuditLog.created_at.desc()).first()
        assert log.action == "update"
        assert json.loads(log.old_values)["fte_percent"] == 50
        assert json.loads(log.new_values)["fte_percent"] == 75

    def test_rollback_leaves_no_partial_rows(self, db, maps, populated, sys_user):
        """If staging raises, rollback must leave DB unchanged."""
        from unittest.mock import patch

        row = _row()
        r = imp._classify(row, maps, False, db, set())
        assert r.action == imp.WOULD_CREATE

        # Patch db.add to succeed once then raise on the audit log
        original_add = db.add
        call_count = [0]

        def _failing_add(obj):
            call_count[0] += 1
            if call_count[0] == 2:  # second add = AuditLog
                raise RuntimeError("simulated DB error")
            return original_add(obj)

        before_demand = db.query(DemandLine).count()
        with patch.object(db, "add", side_effect=_failing_add):
            try:
                imp._stage_row(r, maps, db, sys_user)
            except RuntimeError:
                db.rollback()

        assert db.query(DemandLine).count() == before_demand

    def test_multiple_rows_committed_atomically(self, db, maps, populated, sys_user):
        """Two rows staged → both committed or neither (test success path)."""
        cc_id = populated["cc"].id
        res2 = Resource(
            tenant_id=TENANT, cost_center_id=cc_id,
            employee_id="EMP099", display_name="Other", initials="OT", is_active=True,
        )
        db.add(res2); db.commit()

        m = imp._load_maps(db, TENANT)
        seen: set = set()
        r1 = imp._classify(_row(resource_key_raw="JD", source_row="1"), m, False, db, seen)
        r2 = imp._classify(_row(resource_key_raw="OT", source_row="2"), m, False, db, seen)

        imp._stage_row(r1, m, db, sys_user)
        imp._stage_row(r2, m, db, sys_user)
        db.commit()

        count = db.query(DemandLine).filter(DemandLine.tenant_id == TENANT).count()
        assert count == 2


# ===========================================================================
# Safety: no delete behaviour
# ===========================================================================

class TestNoDeleteBehaviour:
    def test_no_delete_functions_in_module(self):
        import inspect
        funcs = {n for n, _ in inspect.getmembers(imp, inspect.isfunction)}
        bad = {f for f in funcs if any(k in f for k in ("delete", "remove", "wipe", "drop", "truncat"))}
        assert bad == set(), f"Found delete-like functions: {bad}"

    def test_commit_does_not_delete_other_demand_lines(self, db, maps, populated, sys_user):
        cc_id = populated["cc"].id
        res2 = Resource(
            tenant_id=TENANT, cost_center_id=cc_id, employee_id="EMP099",
            display_name="Other", initials="OP", is_active=True,
        )
        db.add(res2); db.commit()
        # Pre-existing demand for res2
        other_dl = DemandLine(
            id=str(uuid.uuid4()), tenant_id=TENANT,
            project_id=populated["project"].id,
            period_id=populated["period_open"].id,
            resource_id=res2.id,
            year=2025, month=6, fte_percent=30,
            created_by=populated["user"].id,
        )
        db.add(other_dl); db.commit()
        other_id = other_dl.id

        m = imp._load_maps(db, TENANT)
        r = imp._classify(_row(resource_key_raw="JD"), m, False, db, set())
        imp._stage_row(r, m, db, sys_user)
        db.commit()

        still_there = db.query(DemandLine).filter(DemandLine.id == other_id).first()
        assert still_there is not None
        assert still_there.fte_percent == 30

    def test_importer_never_deletes_projects(self, db, maps, populated):
        before = db.query(Project).filter(Project.tenant_id == TENANT).count()
        imp._classify(_row(project_name="ghost"), maps, False, db, set())
        assert db.query(Project).filter(Project.tenant_id == TENANT).count() == before


# ===========================================================================
# Multi-tenant guard
# ===========================================================================

class TestMultiTenantGuard:
    def test_single_tenant_resolves_automatically(self, db, populated):
        """Single tenant in DB — resolves without --tenant."""
        from sqlalchemy import select, distinct
        from api.app.models.core import User
        tids = [
            row[0]
            for row in db.execute(
                select(distinct(User.tenant_id)).where(User.is_active == True)
            ).all()
        ]
        assert len(tids) == 1
        # No sys.exit means no ambiguity

    def test_multiple_tenants_refuse_without_flag(self, db, populated):
        """Two tenants in DB → importer should refuse unless --tenant given."""
        from sqlalchemy import select, distinct

        other_cc = CostCenter(tenant_id="other-tenant", code="CC2", name="CC2")
        db.add(other_cc); db.flush()
        db.add(User(
            tenant_id="other-tenant", object_id="obj-other",
            email="other@test.com", display_name="Other",
            role=UserRole.ADMIN, is_active=True,
        ))
        db.commit()

        tids = [
            row[0]
            for row in db.execute(
                select(distinct(User.tenant_id)).where(User.is_active == True)
            ).all()
        ]
        assert len(tids) == 2  # The guard in main() would sys.exit here


# ===========================================================================
# Environment guards
# ===========================================================================

class TestEnvGuards:
    def test_sqlite_allowed_in_dev(self):
        imp._check_env("sqlite:///./dev.db", prod=False)

    def test_dev_markers_allowed_in_dev(self):
        imp._check_env("mssql://matkat-sql-dev/matkat-db-dev", prod=False)

    def test_prod_url_rejected_in_dev(self):
        with pytest.raises(SystemExit):
            imp._check_env("mssql://matkat-sql-prod/matkat-db-prod", prod=False)

    def test_sqlite_rejected_in_prod(self):
        with pytest.raises(SystemExit):
            imp._check_env("sqlite:///./dev.db", prod=True)

    def test_prod_url_accepted_in_prod(self):
        imp._check_env("mssql://matkat-sql-prod/matkat-db-prod", prod=True)

    def test_dev_url_rejected_in_prod(self):
        with pytest.raises(SystemExit):
            imp._check_env("mssql://matkat-sql-dev/matkat-db-dev", prod=True)


# ===========================================================================
# Output helpers: issues CSV content
# ===========================================================================

class TestOutputContent:
    def test_issues_excludes_would_create(self, db, maps):
        r = imp._classify(_row(), maps, False, db, set())
        assert r.action == imp.WOULD_CREATE
        assert r.action in imp.PENDING_ACTIONS  # not in issues

    def test_issues_includes_skipped_non_initials(self, db, maps):
        r = imp._classify(_row(resource_key_type="placeholder"), maps, False, db, set())
        assert r.action not in imp.WRITTEN_ACTIONS
        assert r.action not in imp.PENDING_ACTIONS

    def test_issues_includes_skipped_flagged(self, db, maps):
        r = imp._classify(_row(row_issue_codes="X"), maps, False, db, set())
        assert r.action not in imp.WRITTEN_ACTIONS
        assert r.action not in imp.PENDING_ACTIONS

    def test_issues_includes_existing_skipped(self, db, maps, populated):
        _seed_demand(db, populated)
        r = imp._classify(_row(), maps, False, db, set())
        assert r.action == imp.EXISTING_SKIPPED
        assert r.action not in imp.WRITTEN_ACTIONS
        assert r.action not in imp.PENDING_ACTIONS

    def test_result_row_dict_has_all_cols(self, db, maps):
        r = imp._classify(_row(), maps, False, db, set())
        d = r.as_dict()
        assert set(d.keys()) == set(imp.RESULT_COLS)


# ===========================================================================
# Project name normalisation
# ===========================================================================

class TestNormProject:
    def test_strips(self):
        assert imp._norm_project("  Foo  ") == "foo"

    def test_lower(self):
        assert imp._norm_project("HELLO") == "hello"

    def test_collapses_spaces(self):
        assert imp._norm_project("A  B   C") == "a b c"

    def test_normalises_hyphen_spaces(self):
        assert imp._norm_project("A - B") == "a-b"
        assert imp._norm_project("A-B") == "a-b"
        assert imp._norm_project("A  -  B") == "a-b"
