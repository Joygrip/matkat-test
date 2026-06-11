#!/usr/bin/env python3
"""MatKat demand CSV importer.

Safety guarantees — unconditional, never bypassed:
  * NEVER creates, updates, deactivates, or deletes projects.
  * NEVER deletes existing demand lines.
  * NEVER modifies supply, actuals, OoP, equipment, cost centers, users,
    resources, or periods.
  * Only creates/updates demand lines when --commit is explicitly given.
  * Dev:  DATABASE_URL must be SQLite (local) OR contain both
          'matkat-sql-dev' AND 'matkat-db-dev'.
  * Prod: requires --prod + --i-understand-this-modifies-prod-data +
          DATABASE_URL contains 'matkat-sql-prod' AND 'matkat-db-prod'.

Transaction semantics (--commit):
  All demand-line writes are staged in one SQLAlchemy transaction and
  committed with a single db.commit().  If ANY write fails the entire
  transaction is rolled back and the process exits non-zero.  No partial
  imports.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import create_engine, select, distinct
from sqlalchemy.orm import Session, sessionmaker

# ---------------------------------------------------------------------------
# Action / issue codes
# ---------------------------------------------------------------------------
WOULD_CREATE         = "would_create"
WOULD_UPDATE         = "would_update"
EXISTING_SKIPPED     = "existing_target_skipped"
SKIPPED_NON_INITIALS = "skipped_non_initials"
SKIPPED_FLAGGED      = "skipped_flagged_row"
MISSING_PROJECT      = "missing_project"
AMBIGUOUS_PROJECT    = "ambiguous_project"
MISSING_PERIOD       = "missing_period"
LOCKED_PERIOD        = "locked_period"
MISSING_RESOURCE     = "missing_resource_initials"
AMBIGUOUS_RESOURCE   = "ambiguous_resource_initials"
INVALID_FTE          = "invalid_fte"
CREATED              = "created"
UPDATED              = "updated"
DUPLICATE_IN_CSV     = "duplicate_in_csv"
DB_ERROR             = "db_error"

# Actions that represent a successfully written row
WRITTEN_ACTIONS = {CREATED, UPDATED}
# Actions that represent a "will write" classification (dry-run)
PENDING_ACTIONS = {WOULD_CREATE, WOULD_UPDATE}

RESULT_COLS = [
    "source_file", "source_row", "project_name", "period_key",
    "year", "month", "resource_key_raw", "fte_percent",
    "mapped_project_id", "mapped_period_id", "mapped_resource_id",
    "action", "issue_code", "issue_message",
]

# Names that indicate a placeholder / role row — skip in initials-only pass.
PLACEHOLDER_NAMES = frozenset({
    "no name", "lab", "academic", "placeholder", "role", "open", "tbd", "tba",
})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_project(name: str) -> str:
    """Normalise: strip, lower, collapse spaces, normalise hyphen spacing."""
    name = name.strip().lower()
    name = re.sub(r"\s*-\s*", "-", name)
    name = re.sub(r"\s+", " ", name)
    return name


def _validate_fte(raw_str: str) -> tuple[Optional[int], Optional[str]]:
    """Validate FTE without rounding.

    Accepts values that are already an integer multiple of 5 in [5, 100].
    A tiny floating-point tolerance (0.01) is applied to handle Excel float
    representation (e.g. 50.0000001 → 50), but 52.0 is rejected because 52
    is not divisible by 5 — no rounding to 50 or 55.

    Returns (fte_int, None) on success, (None, error_message) on failure.
    """
    try:
        raw = float(raw_str)
    except (ValueError, TypeError):
        return None, f"fte_percent={raw_str!r} is not numeric"

    nearest = round(raw)
    if abs(raw - nearest) > 0.01:
        return None, f"fte_percent={raw} is not an integer value (non-integer FTE not supported)"

    fte = nearest
    if fte < 5 or fte > 100:
        return None, f"fte_percent={fte} is outside valid range [5, 100]"
    if fte % 5 != 0:
        return None, f"fte_percent={fte} is not a multiple of 5 (valid values: 5, 10, …, 100)"

    return fte, None


def _safe_url(url: str) -> str:
    return re.sub(r"://[^:]+:[^@]+@", "://***:***@", url)


# ---------------------------------------------------------------------------
# Environment guards
# ---------------------------------------------------------------------------

def _check_env(db_url: str, prod: bool) -> None:
    lower = db_url.lower()
    if prod:
        if "matkat-sql-prod" not in lower or "matkat-db-prod" not in lower:
            sys.exit(
                "ERROR: --prod requires DATABASE_URL to contain 'matkat-sql-prod' AND "
                "'matkat-db-prod'. Current URL does not match. Refusing."
            )
    else:
        is_sqlite = lower.startswith("sqlite")
        has_dev = "matkat-sql-dev" in lower and "matkat-db-dev" in lower
        if not (is_sqlite or has_dev):
            sys.exit(
                "ERROR: Without --prod, DATABASE_URL must be SQLite (local dev) or contain "
                "'matkat-sql-dev' AND 'matkat-db-dev'. Refusing."
            )


# ---------------------------------------------------------------------------
# DB session
# ---------------------------------------------------------------------------

def _make_session(db_url: str) -> Session:
    if db_url.lower().startswith("sqlite"):
        engine = create_engine(db_url, connect_args={"check_same_thread": False})
    else:
        engine = create_engine(db_url, pool_pre_ping=True)
    Sess = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return Sess()


# ---------------------------------------------------------------------------
# Lookup maps
# ---------------------------------------------------------------------------

@dataclass
class _Maps:
    tenant_id: str
    # norm_name -> [(project_id, display_name)]
    projects: dict
    # (year, month) -> (period_id, PeriodStatus)
    periods: dict
    # initials_lower -> [(resource_id, display_name)]
    resources: dict


def _load_maps(db: Session, tenant_id: str) -> _Maps:
    from api.app.models.core import Project, Period, Resource

    projects: dict = {}
    for p in db.query(Project).filter(Project.tenant_id == tenant_id).all():
        projects.setdefault(_norm_project(p.name), []).append((p.id, p.name))

    periods: dict = {}
    for p in db.query(Period).filter(Period.tenant_id == tenant_id).all():
        # Store the enum value directly — compare with PeriodStatus.LOCKED in classify
        periods[(p.year, p.month)] = (p.id, p.status)

    resources: dict = {}
    for r in (
        db.query(Resource)
        .filter(Resource.tenant_id == tenant_id, Resource.is_active == True)
        .all()
    ):
        if r.initials:
            key = r.initials.strip().lower()
            resources.setdefault(key, []).append((r.id, r.display_name))

    return _Maps(tenant_id=tenant_id, projects=projects, periods=periods, resources=resources)


# ---------------------------------------------------------------------------
# Result row
# ---------------------------------------------------------------------------

@dataclass
class _Row:
    source_file: str
    source_row: str
    project_name: str
    period_key: str
    year: str
    month: str
    resource_key_raw: str
    fte_percent: str
    mapped_project_id: str = ""
    mapped_period_id: str = ""
    mapped_resource_id: str = ""
    action: str = ""
    issue_code: str = ""
    issue_message: str = ""
    # Internal state — not written to CSV
    _year_int: int = 0
    _month_int: int = 0
    _fte_int: int = 0
    _old_fte: Optional[int] = None          # cached for upsert audit log
    _existing_demand_id: Optional[str] = None  # cached for upsert

    def as_dict(self) -> dict:
        return {c: getattr(self, c) for c in RESULT_COLS}


# ---------------------------------------------------------------------------
# Classification (reads DB, never writes)
# ---------------------------------------------------------------------------

def _classify(
    csv_row: dict,
    maps: _Maps,
    upsert: bool,
    db: Session,
    seen: set,
) -> _Row:
    """Classify one CSV row. Reads DB but never writes anything."""
    from api.app.models.core import PeriodStatus
    from api.app.models.planning import DemandLine

    r = _Row(
        source_file=csv_row.get("source_file", ""),
        source_row=csv_row.get("source_row", ""),
        project_name=csv_row.get("project_name", ""),
        period_key=csv_row.get("period_key", ""),
        year=csv_row.get("year", ""),
        month=csv_row.get("month", ""),
        resource_key_raw=csv_row.get("resource_key_raw", ""),
        fte_percent=csv_row.get("fte_percent", ""),
    )

    def _reject(action: str, msg: str) -> _Row:
        r.action = action
        r.issue_code = action
        r.issue_message = msg
        return r

    # 1 – resource_key_type must be "initials"
    rkt = csv_row.get("resource_key_type", "").strip().lower()
    if rkt != "initials":
        return _reject(SKIPPED_NON_INITIALS, f"resource_key_type={rkt!r}")

    # 2 – ready_for_mapping must be TRUE
    ready = csv_row.get("ready_for_mapping", "").strip().upper()
    if ready not in ("TRUE", "1", "YES"):
        return _reject(SKIPPED_NON_INITIALS, f"ready_for_mapping={csv_row.get('ready_for_mapping', '')!r}")

    # 3 – row_issue_codes must be blank
    codes = csv_row.get("row_issue_codes", "").strip()
    if codes:
        return _reject(SKIPPED_FLAGGED, f"row_issue_codes={codes!r}")

    # 4 – skip known placeholder / role names
    resource_raw = csv_row.get("resource_key_raw", "").strip()
    if resource_raw.lower() in PLACEHOLDER_NAMES:
        return _reject(SKIPPED_NON_INITIALS, f"Placeholder/role name skipped: {resource_raw!r}")

    # 5 – project lookup
    proj_name = csv_row.get("project_name", "").strip()
    matches = maps.projects.get(_norm_project(proj_name), [])
    if len(matches) == 0:
        return _reject(MISSING_PROJECT, f"No project named {proj_name!r}")
    if len(matches) > 1:
        names = ", ".join(m[1] for m in matches)
        return _reject(AMBIGUOUS_PROJECT, f"Multiple projects match {proj_name!r}: {names}")
    project_id = matches[0][0]
    r.mapped_project_id = project_id

    # 6 – period lookup
    try:
        year = int(r.year)
        month = int(r.month)
    except (ValueError, TypeError):
        return _reject(MISSING_PERIOD, f"Invalid year/month: {r.year!r}/{r.month!r}")
    entry = maps.periods.get((year, month))
    if entry is None:
        return _reject(MISSING_PERIOD, f"No period {year}-{month:02d} in tenant")
    period_id, period_status = entry
    if period_status == PeriodStatus.LOCKED:
        return _reject(LOCKED_PERIOD, f"Period {year}-{month:02d} is LOCKED")
    r.mapped_period_id = period_id
    r._year_int = year
    r._month_int = month

    # 7 – resource initials lookup
    initials_key = resource_raw.lower()
    res_matches = maps.resources.get(initials_key, [])
    if len(res_matches) == 0:
        return _reject(MISSING_RESOURCE, f"No active resource with initials {resource_raw!r}")
    if len(res_matches) > 1:
        names = ", ".join(m[1] for m in res_matches)
        return _reject(AMBIGUOUS_RESOURCE, f"Ambiguous initials {resource_raw!r}: {names}")
    resource_id = res_matches[0][0]
    r.mapped_resource_id = resource_id

    # 8 – FTE validation (no rounding — reject non-multiples of 5)
    fte_int, fte_err = _validate_fte(r.fte_percent)
    if fte_err:
        return _reject(INVALID_FTE, fte_err)
    r._fte_int = fte_int
    r.fte_percent = str(fte_int)

    # 9 – duplicate-within-CSV guard
    dedup_key = (project_id, resource_id, year, month)
    if dedup_key in seen:
        return _reject(
            DUPLICATE_IN_CSV,
            f"Duplicate CSV row for ({proj_name}, {resource_raw}, {year}-{month:02d}); "
            f"fte_percent={fte_int}",
        )
    seen.add(dedup_key)

    # 10 – check existing DB demand line
    existing = (
        db.query(DemandLine)
        .filter(
            DemandLine.tenant_id == maps.tenant_id,
            DemandLine.project_id == project_id,
            DemandLine.resource_id == resource_id,
            DemandLine.year == year,
            DemandLine.month == month,
        )
        .first()
    )
    if existing is not None:
        if not upsert or existing.fte_percent == fte_int:
            suffix = "" if upsert else "; use --upsert to update"
            r.action = EXISTING_SKIPPED
            r.issue_code = EXISTING_SKIPPED
            r.issue_message = f"Exists (id={existing.id}, fte={existing.fte_percent}){suffix}"
            return r
        # Cache old fte and id so the commit phase doesn't need a second query
        r._old_fte = existing.fte_percent
        r._existing_demand_id = existing.id
        r.action = WOULD_UPDATE
        return r

    r.action = WOULD_CREATE
    return r


# ---------------------------------------------------------------------------
# Staging (adds objects to session — NO db.commit() called here)
# ---------------------------------------------------------------------------

def _stage_row(
    r: _Row,
    maps: _Maps,
    db: Session,
    system_user,
) -> None:
    """Stage a DemandLine + AuditLog in the open transaction.

    Intentionally does NOT call db.commit() — the caller commits once after
    all rows are staged so the entire batch is all-or-nothing.

    We create AuditLog rows directly instead of calling log_audit() because
    log_audit() calls db.commit() internally, which would break all-or-nothing
    semantics.
    """
    from api.app.models.planning import DemandLine
    from api.app.models.audit import AuditLog

    year = r._year_int
    month = r._month_int
    fte_int = r._fte_int
    now_str = None  # AuditLog.created_at defaults to datetime.utcnow

    def _make_audit(action: str, entity_id: str, old_vals: Optional[dict], new_vals: dict) -> AuditLog:
        return AuditLog(
            id=str(uuid.uuid4()),
            tenant_id=maps.tenant_id,
            user_id=system_user.object_id,
            user_email=system_user.email,
            action=action,
            entity_type="demand_line",
            entity_id=entity_id,
            old_values=json.dumps(old_vals) if old_vals else None,
            new_values=json.dumps(new_vals),
            details=json.dumps({
                "source": "csv_import",
                "source_file": r.source_file,
                "source_row": r.source_row,
            }),
        )

    if r.action == WOULD_CREATE:
        dl_id = str(uuid.uuid4())
        dl = DemandLine(
            id=dl_id,
            tenant_id=maps.tenant_id,
            period_id=r.mapped_period_id,
            project_id=r.mapped_project_id,
            resource_id=r.mapped_resource_id,
            placeholder_id=None,
            year=year,
            month=month,
            fte_percent=fte_int,
            created_by=system_user.id,
        )
        db.add(dl)
        db.add(_make_audit(
            "create", dl_id, None,
            {
                "project_id": r.mapped_project_id,
                "resource_id": r.mapped_resource_id,
                "period_id": r.mapped_period_id,
                "year": year, "month": month, "fte_percent": fte_int,
            },
        ))

    elif r.action == WOULD_UPDATE:
        # Fetch the row that was identified during classify — still present
        # in the same transaction (no concurrent writers in a CLI import).
        from api.app.models.planning import DemandLine as DL
        existing = db.query(DL).filter(DL.id == r._existing_demand_id).first()
        if existing is None:
            raise RuntimeError(
                f"DemandLine {r._existing_demand_id!r} disappeared between "
                f"classification and commit (row {r.source_row})"
            )
        old_fte = existing.fte_percent  # should equal r._old_fte
        existing.fte_percent = fte_int
        db.add(_make_audit(
            "update", existing.id,
            {"fte_percent": old_fte},
            {"fte_percent": fte_int},
        ))

    else:
        raise RuntimeError(
            f"_stage_row called with unexpected action {r.action!r} on row {r.source_row}"
        )


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _write_outputs(
    results: list,
    result_path: str,
    issues_path: str,
    summary_path: str,
    dry_run: bool,
    project_filter: list,
) -> None:
    # result CSV — every classified row
    with open(result_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=RESULT_COLS)
        w.writeheader()
        w.writerows(r.as_dict() for r in results)

    # issues CSV — all rows that were NOT written (or will not be written)
    # Includes: skipped, flagged, errors, existing-skipped, and all issue codes
    issues = [r for r in results if r.action not in WRITTEN_ACTIONS and r.action not in PENDING_ACTIONS]
    with open(issues_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=RESULT_COLS)
        w.writeheader()
        w.writerows(r.as_dict() for r in issues)

    summary = {
        "mode": "dry_run" if dry_run else "commit",
        "project_filter": project_filter,
        "total_rows_processed": len(results),
        "counts": dict(Counter(r.action for r in results)),
    }
    with open(summary_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    return issues


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="MatKat demand CSV importer")
    ap.add_argument("--file", required=True, help="Path to CSV file")
    ap.add_argument(
        "--project", action="append", default=[], metavar="NAME",
        help="Filter to specific project name (repeatable)",
    )
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", default=True)
    ap.add_argument("--commit", dest="commit", action="store_true", default=False)
    ap.add_argument("--upsert", action="store_true", default=False,
                    help="Update existing demand lines when FTE differs")
    ap.add_argument("--prod", action="store_true", default=False)
    ap.add_argument(
        "--i-understand-this-modifies-prod-data",
        dest="prod_ack", action="store_true", default=False,
    )
    ap.add_argument("--tenant", default=None,
                    help="Tenant ID (required when DB contains multiple tenants)")
    ap.add_argument("--result-csv", default="import_result.csv")
    ap.add_argument("--issues-csv", default="import_issues.csv")
    ap.add_argument("--summary-json", default="import_summary.json")
    args = ap.parse_args()

    dry_run = not args.commit

    if args.prod and not args.prod_ack:
        sys.exit(
            "ERROR: --prod requires --i-understand-this-modifies-prod-data. Refusing."
        )

    db_url = os.environ.get("DATABASE_URL", "sqlite:///./dev.db")
    _check_env(db_url, args.prod)

    print(f"[importer] database : {_safe_url(db_url)}")
    print(f"[importer] mode     : {'DRY-RUN' if dry_run else 'COMMIT'}")
    if args.upsert:
        print("[importer] upsert   : enabled")
    if args.project:
        print(f"[importer] filter   : {args.project}")

    db = _make_session(db_url)

    # --- Resolve tenant ---
    from api.app.models.core import User
    from api.app.auth.dependencies import CurrentUser

    if args.tenant:
        tenant_id = args.tenant
        user = db.query(User).filter(User.tenant_id == tenant_id, User.is_active == True).first()
        if user is None:
            db.close()
            sys.exit(f"ERROR: No active users found for tenant {tenant_id!r}.")
    else:
        # Detect tenants; refuse if ambiguous
        tids = [
            row[0]
            for row in db.execute(
                select(distinct(User.tenant_id)).where(User.is_active == True)
            ).all()
        ]
        if len(tids) == 0:
            db.close()
            sys.exit("ERROR: No active users in DB. Cannot resolve tenant_id.")
        if len(tids) > 1:
            db.close()
            sys.exit(
                f"ERROR: Multiple tenants found {tids}. "
                "Use --tenant <id> to select one explicitly."
            )
        tenant_id = tids[0]
        user = db.query(User).filter(User.tenant_id == tenant_id, User.is_active == True).first()

    system_user = CurrentUser(
        id=user.id,
        tenant_id=tenant_id,
        object_id=user.object_id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
    )
    print(f"[importer] tenant   : {tenant_id}")
    print(f"[importer] audit as : {system_user.email}")

    # --- Load lookups ---
    maps = _load_maps(db, tenant_id)
    print(
        f"[importer] loaded   : {len(maps.projects)} projects, "
        f"{len(maps.periods)} periods, "
        f"{len(maps.resources)} resource-initials entries"
    )

    # --- Read CSV ---
    with open(args.file, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    print(f"[importer] csv rows : {len(rows)}")

    # --- Apply project filter ---
    if args.project:
        norm_filter = {_norm_project(p) for p in args.project}
        rows = [r for r in rows if _norm_project(r.get("project_name", "")) in norm_filter]
        print(f"[importer] filtered : {len(rows)} rows after project filter")

    # --- Classify (dry-run pass — no DB writes) ---
    seen: set = set()
    results: list = []
    for csv_row in rows:
        results.append(_classify(csv_row, maps, args.upsert, db, seen))

    counts = Counter(r.action for r in results)
    print("\n[importer] classification:")
    for action in sorted(counts):
        print(f"  {action:<42} {counts[action]}")

    # --- Commit pass (all-or-nothing) ---
    if not dry_run:
        to_write = [
            (i, r) for i, r in enumerate(results)
            if r.action in PENDING_ACTIONS
        ]
        print(f"\n[importer] staging {len(to_write)} demand lines …")
        try:
            for i, r in to_write:
                _stage_row(r, maps, db, system_user)
                # Update in-memory result to reflect intended final state
                results[i].action = CREATED if r.action == WOULD_CREATE else UPDATED
            db.commit()
            print(f"[importer] committed {len(to_write)} demand lines.")
        except Exception as exc:
            db.rollback()
            for i, _ in to_write:
                results[i].action = DB_ERROR
                results[i].issue_code = DB_ERROR
                results[i].issue_message = f"Transaction rolled back: {exc}"
            print(f"\nERROR: Transaction rolled back — {exc}", file=sys.stderr)
            print("No demand lines were written.", file=sys.stderr)
            issues = _write_outputs(
                results, args.result_csv, args.issues_csv, args.summary_json,
                dry_run, args.project,
            )
            print(f"\n[importer] result  → {args.result_csv}")
            print(f"[importer] issues  → {args.issues_csv}  ({len(issues)} issues)")
            print(f"[importer] summary → {args.summary_json}")
            db.close()
            sys.exit(1)

    # --- Write outputs ---
    issues = _write_outputs(
        results, args.result_csv, args.issues_csv, args.summary_json,
        dry_run, args.project,
    )
    print(f"\n[importer] result  → {args.result_csv}")
    print(f"[importer] issues  → {args.issues_csv}  ({len(issues)} issues)")
    print(f"[importer] summary → {args.summary_json}")
    db.close()


if __name__ == "__main__":
    main()
