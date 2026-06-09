"""
RUNBOOK
=======
MatKat transactional data cleanup script — supports DEV and PROD environments.

Deletes planning/testing data while preserving reference data
(users, resources, projects, cost_centers, periods, finance settings,
roles, approval_delegates, audit_logs, graph sync, app config).

PREREQUISITES
  $env:PYTHONPATH = "C:\\VSCode\\ResourceAllocation-master"

  DEV:
    $env:DATABASE_URL = "mssql+pyodbc://user:password@matkat-sql-dev.database.windows.net/matkat-db-dev?driver=ODBC+Driver+18+for+SQL+Server"

  PROD:
    $env:DATABASE_URL = "mssql+pyodbc://user:password@matkat-sql-prod.database.windows.net/matkat-db-prod?driver=ODBC+Driver+18+for+SQL+Server"

DEV DRY-RUN (default — no data deleted, transaction is rolled back):
  python api/cleanup_transactional_data.py

DEV COMMIT (permanently deletes DEV data — explicit flag required):
  python api/cleanup_transactional_data.py --commit

PROD DRY-RUN (safe inspection of PROD row counts — no data deleted):
  python api/cleanup_transactional_data.py --prod --i-understand-this-deletes-prod-data

PROD COMMIT (permanently deletes PROD data — use with extreme care):
  python api/cleanup_transactional_data.py --prod --i-understand-this-deletes-prod-data --commit

COMMIT while keeping snapshots (either environment):
  python api/cleanup_transactional_data.py [--prod --i-understand-this-deletes-prod-data] --commit --keep-snapshots

VERIFY row counts (always safe — dry-run shows before/after inside rolled-back tx):
  python api/cleanup_transactional_data.py [--prod --i-understand-this-deletes-prod-data]
"""

import argparse
import os
import re
import sys

from sqlalchemy import create_engine, text


# ─── Safety guards ────────────────────────────────────────────────────────────

DEV_MARKERS   = ("matkat-sql-dev", "matkat-db-dev")
# All markers whose presence in a URL signals prod (used to reject prod in dev mode)
PROD_MARKERS  = ("matkat-sql-prod", "matkat-db-prod", "rg-matkat-prd")
# Markers that must both be present for prod mode to proceed
PROD_REQUIRED = ("matkat-sql-prod", "matkat-db-prod")


def _url_hint(url: str) -> str:
    """Return a loggable hint — host/db visible, credentials masked."""
    masked = re.sub(r"://[^@]+@", "://***:***@", url)
    masked = re.sub(r"(PWD|Password)=[^;)&]+", r"\1=***", masked, flags=re.IGNORECASE)
    return masked


def verify_dev_safety(url: str) -> None:
    """Abort if prod markers are present or required dev markers are absent."""
    lower = url.lower()

    for marker in PROD_MARKERS:
        if marker in lower:
            print(f"ABORT: PROD marker detected in DATABASE_URL: '{marker}'")
            print("This script must only run against the DEV database.")
            print("To run against PROD, pass: --prod --i-understand-this-deletes-prod-data")
            sys.exit(1)

    missing = [m for m in DEV_MARKERS if m not in lower]
    if missing:
        print("ABORT: Required DEV marker(s) not found in DATABASE_URL:")
        for m in missing:
            print(f"  - '{m}'")
        print(
            "Expected both 'matkat-sql-dev' and 'matkat-db-dev' in the connection string."
        )
        print("Pass --allow-non-dev to bypass this check for local/test DBs.")
        sys.exit(1)


def verify_prod_safety(url: str) -> None:
    """Abort if dev markers are present or required prod markers are absent."""
    lower = url.lower()

    for marker in DEV_MARKERS:
        if marker in lower:
            print(f"ABORT: DEV marker detected in DATABASE_URL when --prod was passed: '{marker}'")
            print("The DATABASE_URL must point to the PROD database when using --prod.")
            sys.exit(1)

    missing = [m for m in PROD_REQUIRED if m not in lower]
    if missing:
        print("ABORT: Required PROD marker(s) not found in DATABASE_URL:")
        for m in missing:
            print(f"  - '{m}'")
        print(
            "Expected both 'matkat-sql-prod' and 'matkat-db-prod' in the connection string."
        )
        sys.exit(1)


# ─── Table configuration ──────────────────────────────────────────────────────

# FK-safe deletion order.
# approval_actions must precede approval_steps (FK: approval_actions.step_id → approval_steps.id)
# and approval_instances (FK: approval_actions.instance_id → approval_instances.id).
# approval_instances → actual_lines link is logical only (subject_type/subject_id), no FK constraint.
ALL_TABLES: list[str] = [
    "publish_snapshot_lines",   # FK → publish_snapshots.id
    "publish_snapshots",        # FK → periods.id
    "approval_actions",         # FK → approval_instances.id, approval_steps.id
    "approval_steps",           # FK → approval_instances.id
    "approval_instances",       # logical link to actual_lines via subject_type/subject_id
    "actual_lines",
    "demand_lines",
    "supply_lines",
]

SNAPSHOT_TABLES = frozenset({"publish_snapshot_lines", "publish_snapshots"})


# ─── Helpers ─────────────────────────────────────────────────────────────────


def get_counts(conn, tables: list[str]) -> dict[str, int]:
    return {
        t: conn.execute(text(f"SELECT COUNT(*) FROM [{t}]")).scalar()
        for t in tables
    }


def print_counts(label: str, counts: dict[str, int]) -> None:
    print(f"\n{label}")
    for table, n in counts.items():
        print(f"  {table:<35} {n:>8,}")


# ─── Cleanup statements ───────────────────────────────────────────────────────


def run_cleanup(conn, keep_snapshots: bool) -> None:
    """Execute DELETEs in FK-safe order inside the caller's transaction."""

    def _del(stmt: str) -> int:
        return conn.execute(text(stmt)).rowcount

    print("\nDeleting (inside transaction):")

    if not keep_snapshots:
        n = _del("DELETE FROM [publish_snapshot_lines]")
        print(f"  => publish_snapshot_lines: {n:,} row(s)")
        n = _del("DELETE FROM [publish_snapshots]")
        print(f"  => publish_snapshots:      {n:,} row(s)")

    # approval_actions must come before approval_steps and approval_instances
    # (FK: approval_actions.step_id → approval_steps.id,
    #      approval_actions.instance_id → approval_instances.id)
    n = _del(
        """
        DELETE aa
        FROM   [approval_actions] aa
        JOIN   [approval_instances] ai ON ai.id = aa.instance_id
        WHERE  ai.subject_type = 'actuals'
        """
    )
    print(f"  => approval_actions:       {n:,} row(s)")

    n = _del(
        """
        DELETE ast
        FROM   [approval_steps] ast
        JOIN   [approval_instances] ai ON ai.id = ast.instance_id
        WHERE  ai.subject_type = 'actuals'
        """
    )
    print(f"  => approval_steps:         {n:,} row(s)")

    n = _del("DELETE FROM [approval_instances] WHERE subject_type = 'actuals'")
    print(f"  => approval_instances:     {n:,} row(s)")

    n = _del("DELETE FROM [actual_lines]")
    print(f"  => actual_lines:           {n:,} row(s)")

    n = _del("DELETE FROM [demand_lines]")
    print(f"  => demand_lines:           {n:,} row(s)")

    n = _del("DELETE FROM [supply_lines]")
    print(f"  => supply_lines:           {n:,} row(s)")


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clean MatKat transactional planning/test data (DEV or PROD).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Commit the deletes permanently. Default is dry-run (rollback).",
    )
    parser.add_argument(
        "--keep-snapshots",
        action="store_true",
        help="Skip deletion of publish_snapshots and publish_snapshot_lines.",
    )
    parser.add_argument(
        "--allow-non-dev",
        action="store_true",
        help=(
            "Bypass the matkat-sql-dev / matkat-db-dev marker check. "
            "Use only for local SQLite or isolated test databases."
        ),
    )
    parser.add_argument(
        "--prod",
        action="store_true",
        help=(
            "Target the PROD database. Requires --i-understand-this-deletes-prod-data "
            "and a DATABASE_URL containing matkat-sql-prod and matkat-db-prod."
        ),
    )
    parser.add_argument(
        "--i-understand-this-deletes-prod-data",
        action="store_true",
        dest="i_understand_this_deletes_prod_data",
        help="Required acknowledgement when --prod is passed.",
    )
    args = parser.parse_args()

    # --prod and --allow-non-dev are mutually exclusive
    if args.prod and args.allow_non_dev:
        print("ABORT: --prod and --allow-non-dev cannot be used together.")
        sys.exit(1)

    # --prod requires its explicit acknowledgement flag
    if args.prod and not args.i_understand_this_deletes_prod_data:
        print("ABORT: --prod requires --i-understand-this-deletes-prod-data.")
        print(
            "Re-run with both flags to confirm you intend to modify PROD data:\n"
            "  python api/cleanup_transactional_data.py "
            "--prod --i-understand-this-deletes-prod-data [--commit]"
        )
        sys.exit(1)

    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("ERROR: DATABASE_URL environment variable is not set.")
        sys.exit(1)

    # Route to the correct safety check
    if args.prod:
        verify_prod_safety(db_url)
    elif not args.allow_non_dev:
        verify_dev_safety(db_url)

    # ── Startup banner ────────────────────────────────────────────────────────
    env_label = "PROD" if args.prod else ("NON-DEV (--allow-non-dev)" if args.allow_non_dev else "DEV")
    if args.prod:
        check_line = "PROD check  : PASSED — prod markers verified"
    elif args.allow_non_dev:
        check_line = "DEV check   : BYPASSED (--allow-non-dev)"
    else:
        check_line = "DEV check   : PASSED — dev markers verified"

    print(f"Database    : {_url_hint(db_url)}")
    print(f"Environment : {env_label}")
    print(check_line)
    print(f"Mode        : {'COMMIT — data will be permanently deleted' if args.commit else 'DRY RUN — transaction will be rolled back'}")
    print(f"Snapshots   : {'kept (--keep-snapshots)' if args.keep_snapshots else 'included in cleanup'}")

    active_tables = [t for t in ALL_TABLES if not (args.keep_snapshots and t in SNAPSHOT_TABLES)]

    engine = create_engine(db_url)

    with engine.connect() as conn:
        trans = conn.begin()

        try:
            # SET XACT_ABORT ON: if any T-SQL statement errors, SQL Server auto-rolls back the tx.
            conn.execute(text("SET XACT_ABORT ON"))

            before = get_counts(conn, active_tables)
            print_counts("Before cleanup:", before)

            run_cleanup(conn, keep_snapshots=args.keep_snapshots)

            after = get_counts(conn, active_tables)
            print_counts("After cleanup (inside transaction):", after)

            if args.commit:
                trans.commit()
                print("\nCOMMITTED. Data has been permanently deleted.")
            else:
                trans.rollback()
                print("\nROLLED BACK. No data was deleted.")

        except Exception as exc:
            trans.rollback()
            print(f"\nERROR — transaction rolled back: {exc}")
            sys.exit(1)


if __name__ == "__main__":
    main()
