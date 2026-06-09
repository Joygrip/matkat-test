"""
RUNBOOK
=======
MatKat add-period-years script — inserts missing monthly period rows for requested years.

Supports DEV and PROD environments. Default is dry-run (transaction rolled back).
Use --commit to persist.

PREREQUISITES
  $env:PYTHONPATH = "C:\\VSCode\\ResourceAllocation-master"

  DEV:
    $env:DATABASE_URL = "mssql+pyodbc://user:password@matkat-sql-dev.database.windows.net/matkat-db-dev?driver=ODBC+Driver+18+for+SQL+Server"

  PROD:
    $env:DATABASE_URL = "mssql+pyodbc://user:password@matkat-sql-prod.database.windows.net/matkat-db-prod?driver=ODBC+Driver+18+for+SQL+Server"

DEV DRY-RUN (default — shows planned inserts, transaction rolled back):
  python api/add_period_years.py 2025

DEV COMMIT (permanently inserts rows):
  python api/add_period_years.py 2025 --commit

Multiple years:
  python api/add_period_years.py 2024 2025 --commit

PROD DRY-RUN (safe inspection — no data written):
  python api/add_period_years.py 2025 --prod --i-understand-this-modifies-prod-data

PROD COMMIT:
  python api/add_period_years.py 2025 --prod --i-understand-this-modifies-prod-data --commit

STATUS FLAG (--status auto|open|locked, default: auto)
  --status auto    Historical years (< current year) → locked.
                   Current and future years          → open.   [DEFAULT]
  --status locked  All inserted periods are locked regardless of year.
  --status open    All inserted periods are open regardless of year.

  Examples:
    python api/add_period_years.py 2024 2025           # 2024→locked, 2025→locked (past years)
    python api/add_period_years.py 2024 --status open  # override: 2024→open
    python api/add_period_years.py 2027 --status locked  # override: future year→locked

VERIFY after run:
  SELECT year, month, status, monthly_fte_cost
  FROM   periods
  WHERE  year IN (2025)
  ORDER  BY year, month

SAFETY CONTRACT
  - Never deletes or updates existing rows.
  - Skips tenant/year/month that already exist (unique constraint respected).
  - Existing period status and monthly_fte_cost are never modified.
  - Refuses years < 2000 or > current_year + 20.
  - Requires --commit to persist; default rolls back.
  - Historical years (< current year) default to status='locked' with --status auto
    to prevent them from disrupting default period selection and scheduler logic.
"""

import argparse
import os
import re
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, text


# ─── Constants ────────────────────────────────────────────────────────────────

DEFAULT_MONTHLY_FTE_COST = 99000

MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

# ─── Safety guards (same markers as cleanup_transactional_data.py) ────────────

DEV_MARKERS   = ("matkat-sql-dev", "matkat-db-dev")
PROD_MARKERS  = ("matkat-sql-prod", "matkat-db-prod", "rg-matkat-prd")
PROD_REQUIRED = ("matkat-sql-prod", "matkat-db-prod")


def _url_hint(url: str) -> str:
    """Return a loggable hint — host/db visible, credentials masked."""
    masked = re.sub(r"://[^@]+@", "://***:***@", url)
    masked = re.sub(r"(PWD|Password)=[^;)&]+", r"\1=***", masked, flags=re.IGNORECASE)
    return masked


def verify_dev_safety(url: str) -> None:
    lower = url.lower()
    for marker in PROD_MARKERS:
        if marker in lower:
            print(f"ABORT: PROD marker detected in DATABASE_URL: '{marker}'")
            print("This script must only run against the DEV database in dev mode.")
            print("To run against PROD, pass: --prod --i-understand-this-modifies-prod-data")
            sys.exit(1)
    missing = [m for m in DEV_MARKERS if m not in lower]
    if missing:
        print("ABORT: Required DEV marker(s) not found in DATABASE_URL:")
        for m in missing:
            print(f"  - '{m}'")
        print("Expected both 'matkat-sql-dev' and 'matkat-db-dev' in the connection string.")
        print("Pass --allow-non-dev to bypass this check for local/test databases.")
        sys.exit(1)


def verify_prod_safety(url: str) -> None:
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
        print("Expected both 'matkat-sql-prod' and 'matkat-db-prod' in the connection string.")
        sys.exit(1)


# ─── Year validation ──────────────────────────────────────────────────────────

def validate_years(raw_years: list[str]) -> list[int]:
    current_year = datetime.now(tz=timezone.utc).year
    years = []
    for raw in raw_years:
        try:
            y = int(raw)
        except ValueError:
            print(f"ABORT: '{raw}' is not a valid integer year.")
            sys.exit(1)
        if y < 2000:
            print(f"ABORT: Year {y} is before 2000, which is likely a mistake.")
            sys.exit(1)
        if y > current_year + 20:
            print(f"ABORT: Year {y} is more than 20 years in the future (current year: {current_year}).")
            sys.exit(1)
        years.append(y)
    return sorted(set(years))


# ─── Status resolution ────────────────────────────────────────────────────────

def _resolve_status_for_year(year: int, current_year: int, status_mode: str = "auto") -> str:
    """Return 'open' or 'locked' for a period year given the --status mode.

    - 'auto':   'locked' for year < current_year, 'open' otherwise.
    - 'open':   always 'open'.
    - 'locked': always 'locked'.
    """
    if status_mode == "open":
        return "open"
    if status_mode == "locked":
        return "locked"
    # auto: past years default to locked to protect default period selection
    return "locked" if year < current_year else "open"


# ─── Tenant discovery ─────────────────────────────────────────────────────────

def discover_tenants(conn) -> list[str]:
    """Return distinct tenant_ids from periods, falling back to users, then cost_centers."""
    rows = conn.execute(text("SELECT DISTINCT tenant_id FROM [periods]")).fetchall()
    tenants = [r[0] for r in rows if r[0]]
    if tenants:
        return sorted(tenants)

    rows = conn.execute(text("SELECT DISTINCT tenant_id FROM [users]")).fetchall()
    tenants = [r[0] for r in rows if r[0]]
    if tenants:
        print("  (no periods rows found — derived tenant_ids from users table)")
        return sorted(tenants)

    rows = conn.execute(text("SELECT DISTINCT tenant_id FROM [cost_centers]")).fetchall()
    tenants = [r[0] for r in rows if r[0]]
    if tenants:
        print("  (no periods or users rows found — derived tenant_ids from cost_centers table)")
        return sorted(tenants)

    print("ABORT: No tenant_ids found in periods, users, or cost_centers tables.")
    print("Cannot determine which tenants to insert periods for.")
    sys.exit(1)


# ─── monthly_fte_cost resolution ─────────────────────────────────────────────

def resolve_fte_cost(conn, tenant_id: str) -> int:
    """
    Resolution order (matches service logic in api/app/services/period.py):
      1. Most recent existing period for this tenant.
      2. finance_settings row with setting_key = 'monthly_fte_cost'.
      3. Hardcoded default 99000.
    """
    row = conn.execute(
        text(
            "SELECT TOP 1 monthly_fte_cost "
            "FROM   [periods] "
            "WHERE  tenant_id = :tid "
            "ORDER  BY year DESC, month DESC"
        ),
        {"tid": tenant_id},
    ).fetchone()
    if row and row[0] is not None:
        return int(row[0])

    row = conn.execute(
        text(
            "SELECT setting_value "
            "FROM   [finance_settings] "
            "WHERE  tenant_id = :tid AND setting_key = 'monthly_fte_cost'"
        ),
        {"tid": tenant_id},
    ).fetchone()
    if row and row[0] is not None:
        try:
            return int(row[0])
        except (ValueError, TypeError):
            pass

    return DEFAULT_MONTHLY_FTE_COST


# ─── Existing period lookup ───────────────────────────────────────────────────

def existing_months(conn, tenant_id: str, year: int) -> set[int]:
    rows = conn.execute(
        text(
            "SELECT month FROM [periods] "
            "WHERE  tenant_id = :tid AND year = :yr"
        ),
        {"tid": tenant_id, "yr": year},
    ).fetchall()
    return {r[0] for r in rows}


def period_count_by_year(conn, years: list[int]) -> dict[int, int]:
    placeholders = ", ".join(f":y{i}" for i in range(len(years)))
    params = {f"y{i}": y for i, y in enumerate(years)}
    rows = conn.execute(
        text(
            f"SELECT year, COUNT(*) "
            f"FROM   [periods] "
            f"WHERE  year IN ({placeholders}) "
            f"GROUP  BY year"
        ),
        params,
    ).fetchall()
    counts = {y: 0 for y in years}
    for row in rows:
        counts[row[0]] = row[1]
    return counts


# ─── Insert logic ─────────────────────────────────────────────────────────────

def insert_periods(
    conn, tenant_id: str, year: int, months_to_insert: list[int], fte_cost: int, status: str
) -> int:
    now = datetime.now(timezone.utc)
    inserted = 0
    for month in months_to_insert:
        conn.execute(
            text(
                "INSERT INTO [periods] "
                "  (id, tenant_id, year, month, monthly_fte_cost, status, created_at, updated_at) "
                "VALUES "
                "  (:id, :tid, :yr, :mo, :fte, :status, :now, :now)"
            ),
            {
                "id":     str(uuid.uuid4()),
                "tid":    tenant_id,
                "yr":     year,
                "mo":     month,
                "fte":    fte_cost,
                "status": status,
                "now":    now,
            },
        )
        inserted += 1
    return inserted


# ─── Entry point ─────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Insert missing period rows for one or more years (MatKat DEV or PROD).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "years",
        nargs="+",
        metavar="YEAR",
        help="One or more calendar years to add (e.g. 2025 or 2024 2025).",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Commit the inserts permanently. Default is dry-run (rollback).",
    )
    parser.add_argument(
        "--status",
        choices=["auto", "open", "locked"],
        default="auto",
        help=(
            "Status for newly inserted periods. "
            "'auto' (default): locked for past years, open for current/future. "
            "'open': always open. "
            "'locked': always locked."
        ),
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
            "Target the PROD database. Requires --i-understand-this-modifies-prod-data "
            "and a DATABASE_URL containing matkat-sql-prod and matkat-db-prod."
        ),
    )
    parser.add_argument(
        "--i-understand-this-modifies-prod-data",
        action="store_true",
        dest="i_understand_this_modifies_prod_data",
        help="Required acknowledgement when --prod is passed.",
    )
    args = parser.parse_args()

    if args.prod and args.allow_non_dev:
        print("ABORT: --prod and --allow-non-dev cannot be used together.")
        sys.exit(1)

    if args.prod and not args.i_understand_this_modifies_prod_data:
        print("ABORT: --prod requires --i-understand-this-modifies-prod-data.")
        print(
            "Re-run with both flags to confirm you intend to modify PROD data:\n"
            "  python api/add_period_years.py YEAR "
            "--prod --i-understand-this-modifies-prod-data [--commit]"
        )
        sys.exit(1)

    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("ERROR: DATABASE_URL environment variable is not set.")
        sys.exit(1)

    if args.prod:
        verify_prod_safety(db_url)
    elif not args.allow_non_dev:
        verify_dev_safety(db_url)

    years = validate_years(args.years)
    current_year = datetime.now(tz=timezone.utc).year

    env_label = "PROD" if args.prod else ("NON-DEV (--allow-non-dev)" if args.allow_non_dev else "DEV")
    mode_label = "COMMIT — inserts will be persisted" if args.commit else "DRY RUN — transaction will be rolled back"

    print(f"Database    : {_url_hint(db_url)}")
    print(f"Environment : {env_label}")
    print(f"Mode        : {mode_label}")
    print(f"Status mode : --status {args.status}")
    print(f"Years       : {', '.join(str(y) for y in years)}")

    engine = create_engine(db_url)

    with engine.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text("SET XACT_ABORT ON"))

            tenants = discover_tenants(conn)
            print(f"\nTenants     : {', '.join(tenants)}")

            # ── Before counts ─────────────────────────────────────────────────
            before = period_count_by_year(conn, years)
            print("\nExisting periods before:")
            for y, cnt in sorted(before.items()):
                print(f"  {y}: {cnt}")

            # ── Plan inserts ──────────────────────────────────────────────────
            plan: list[tuple[str, int, list[int], list[int], int, str]] = []
            # (tenant_id, year, to_insert months, to_skip months, fte_cost, status)
            for tenant_id in tenants:
                fte_cost = resolve_fte_cost(conn, tenant_id)
                for year in years:
                    existing = existing_months(conn, tenant_id, year)
                    to_insert = [m for m in range(1, 13) if m not in existing]
                    to_skip   = sorted(existing)
                    resolved_status = _resolve_status_for_year(year, current_year, args.status)
                    plan.append((tenant_id, year, to_insert, to_skip, fte_cost, resolved_status))

            print("\nPlanned inserts:")
            for tenant_id, year, to_insert, to_skip, fte_cost, resolved_status in plan:
                insert_names = ", ".join(MONTH_NAMES[m - 1] for m in to_insert) if to_insert else "none"
                skip_names   = ", ".join(MONTH_NAMES[m - 1] for m in to_skip)   if to_skip   else "none"
                print(f"  tenant {tenant_id}  year {year}:")
                print(f"    create months   : {insert_names}")
                print(f"    skip months     : {skip_names}")
                print(f"    monthly_fte_cost: {fte_cost}")
                print(f"    planned status  : {resolved_status}")

            # ── Execute inserts ───────────────────────────────────────────────
            total_inserted = 0
            total_skipped  = 0
            for tenant_id, year, to_insert, to_skip, fte_cost, resolved_status in plan:
                if to_insert:
                    n = insert_periods(conn, tenant_id, year, to_insert, fte_cost, resolved_status)
                    total_inserted += n
                total_skipped += len(to_skip)

            # ── After counts (inside transaction) ─────────────────────────────
            after = period_count_by_year(conn, years)
            print("\nAfter insert (inside transaction):")
            for y, cnt in sorted(after.items()):
                print(f"  {y}: {cnt}")

            print(f"\nSummary: {total_inserted} row(s) inserted, {total_skipped} row(s) skipped (already existed).")

            if args.commit:
                trans.commit()
                print("\nCOMMITTED. Periods inserted.")
            else:
                trans.rollback()
                print("\nROLLED BACK. No data was changed.")

        except Exception as exc:
            trans.rollback()
            print(f"\nERROR — transaction rolled back: {exc}")
            sys.exit(1)


if __name__ == "__main__":
    main()
