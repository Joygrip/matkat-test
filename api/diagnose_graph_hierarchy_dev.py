                                            #!/usr/bin/env python3
"""
diagnose_graph_hierarchy_dev.py

Read-only Microsoft Graph hierarchy diagnostic for MatKat DEV environment.

Connects to:
  - Azure dev SQL  (matkat-db-dev on matkat-sql-dev)
  - Microsoft Graph (same app credentials as matkat-api-dev App Service)

NEVER writes to DB. NEVER triggers sync. NEVER prints secrets or tokens.

Usage:
    python api/diagnose_graph_hierarchy_dev.py --cost-center "Biomaterial R&D"

Required env vars:
    DATABASE_URL          Azure SQL conn string for dev (mssql+pyodbc://...)
    AZURE_TENANT_ID       Entra tenant GUID
    GRAPH_CLIENT_ID       App registration client ID
    GRAPH_CLIENT_SECRET   App registration client secret

PowerShell setup example:
    $env:DATABASE_URL       = "mssql+pyodbc://<user>:<pass>@matkat-sql-dev.database.windows.net/matkat-db-dev?driver=ODBC+Driver+17+for+SQL+Server"
    $env:AZURE_TENANT_ID    = "<tenant-guid>"
    $env:GRAPH_CLIENT_ID    = "<client-id>"
    $env:GRAPH_CLIENT_SECRET = "<secret>"
    $env:PYTHONPATH         = "C:\\VSCode\\ResourceAllocation-master"
    python api/diagnose_graph_hierarchy_dev.py --cost-center "Biomaterial R&D"

To fetch app setting NAMES (not values) from the dev App Service safely:
    az webapp config appsettings list `
        --name matkat-api-dev `
        --resource-group <your-rg> `
        --query "[].name" `
        --output tsv
"""

# ============================================================
# SECTION A — Safety validation (runs before any other imports)
# ============================================================

import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def _validate_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print(
            "ABORT: DATABASE_URL is not set.\n"
            "Set it to the Azure dev SQL connection string (mssql+pyodbc://...).\n"
            "The local SQLite dev.db is NOT connected to Graph and is irrelevant."
        )
        sys.exit(1)

    url_lower = url.lower()

    if url_lower.startswith("sqlite"):
        print(
            "ABORT: DATABASE_URL is a SQLite URL.\n"
            "This script must connect to Azure dev SQL, not the local dev.db.\n"
            "SQLite has no Graph data — it cannot diagnose manager hierarchy issues."
        )
        sys.exit(1)

    for marker in ("matkat-sql-prod", "matkat-db-prod"):
        if marker in url_lower:
            print(
                f"ABORT: DATABASE_URL contains production marker '{marker}'.\n"
                "This script is for DEV only. Refusing to run against production."
            )
            sys.exit(1)

    dev_markers = ("matkat-sql-dev", "matkat-db-dev")
    if not any(m in url_lower for m in dev_markers):
        print(
            "ABORT: DATABASE_URL does not contain the expected dev Azure SQL markers.\n"
            f"Required (either): {dev_markers}\n"
            f"Received URL prefix: {url[:50]}..."
        )
        sys.exit(1)

    print(f"[SAFETY OK] DATABASE_URL validated — dev Azure SQL confirmed.")
    return url


_DATABASE_URL = _validate_database_url()

# ============================================================
# Imports
# ============================================================

import argparse
import textwrap
from datetime import datetime, timezone
from typing import Optional

import httpx

try:
    from sqlalchemy import create_engine, text as sql_text, func
    from sqlalchemy.orm import sessionmaker, Session
except ImportError:
    print("ABORT: sqlalchemy not installed. Run: pip install sqlalchemy pyodbc")
    sys.exit(1)

try:
    from api.app.models.core import User, CostCenter, Resource, UserRole
    from api.app.services.graph_app_client import GraphAppClient, FETCH_FAILED
    from api.app.config import Settings
except ImportError as exc:
    print(f"ABORT: Cannot import app modules: {exc}")
    print("Set PYTHONPATH to the repo root:")
    print("    $env:PYTHONPATH = 'C:\\VSCode\\ResourceAllocation-master'")
    sys.exit(1)

# ============================================================
# Constants
# ============================================================

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

TARGET_UPNS = [
    "KAHI@ferrosanmd.com",
    "mapi@ferrosanmd.com",
    "arnh@ferrosanmd.com",
    "chza@ferrosanmd.com",
    "assk@ferrosanmd.com",
    "thha@ferrosanmd.com",
    "jefi@ferrosanmd.com",
    "henn@ferrosanmd.com",
    "lang@ferrosanmd.com",
    "juch@ferrosanmd.com",
    "adfa@ferrosanmd.com",
    "afri@ferrosanmd.com",
    "RHLF@ferrosanmd.com",
    "shlp@ferrosanmd.com",
]

DIRECT_REPORTS_UPNS = [
    "KAHI@ferrosanmd.com",
    "afri@ferrosanmd.com",
    "shlp@ferrosanmd.com",
    "RHLF@ferrosanmd.com",
]

_MANAGER_ROLES = {UserRole.MANAGER, UserRole.ADMIN, UserRole.FINANCE, UserRole.PM}

# ============================================================
# Shared helpers
# ============================================================


def _sep(title: str = "") -> None:
    if title:
        print(f"\n{'='*70}")
        print(f"  {title}")
        print(f"{'='*70}")
    else:
        print(f"  {'-'*66}")


def _fmt_user(user: Optional[User], label: str = "") -> str:
    if user is None:
        return "NULL"
    prefix = f"{label}: " if label else ""
    return (
        f"{prefix}{user.display_name} <{user.email}> "
        f"[id={user.id[:8]}... oid={user.object_id[:8]}...]"
    )


def _short(s: Optional[str], n: int = 36) -> str:
    if s is None:
        return "NULL"
    return s if len(s) <= n else s[:n-3] + "..."


# ============================================================
# Settings / credential validation
# ============================================================


def _load_settings() -> Settings:
    """Instantiate Settings from environment (never from lru_cache)."""
    settings = Settings()
    missing = []
    if not settings.azure_tenant_id:
        missing.append("AZURE_TENANT_ID")
    if not settings.graph_client_id:
        missing.append("GRAPH_CLIENT_ID")
    if not settings.graph_client_secret:
        missing.append("GRAPH_CLIENT_SECRET")

    if missing:
        print(f"\n[WARNING] Graph credential(s) missing: {missing}")
        print("  Graph sections D/E/F/G will be skipped.")
        print("  Set the env vars listed above, then re-run.")
    else:
        print(
            f"[GRAPH OK] Credentials present — tenant={settings.azure_tenant_id[:8]}... "
            f"client_id={settings.graph_client_id[:8]}..."
        )
    return settings


def _acquire_token(settings: Settings) -> Optional[str]:
    """Client-credentials token. Returns None on failure. Value never printed."""
    url = (
        f"https://login.microsoftonline.com/{settings.azure_tenant_id}"
        f"/oauth2/v2.0/token"
    )
    payload = {
        "grant_type": "client_credentials",
        "client_id": settings.graph_client_id,
        "client_secret": settings.graph_client_secret,
        "scope": "https://graph.microsoft.com/.default",
    }
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(url, data=payload)
            if resp.status_code != 200:
                print(
                    f"  [AUTH FAIL] status={resp.status_code} "
                    f"body={resp.text[:300]}"
                )
                return None
            print("  [AUTH OK] Token acquired (not printed).")
            return resp.json().get("access_token")
    except Exception as exc:
        print(f"  [AUTH ERROR] {exc}")
        return None


# ============================================================
# Database connection
# ============================================================


def _connect_db() -> Session:
    try:
        engine = create_engine(_DATABASE_URL, echo=False)
        factory = sessionmaker(bind=engine)
        db: Session = factory()
        db.execute(sql_text("SELECT 1"))
        print("[SQL OK] Connected to Azure dev SQL.")
        return db
    except Exception as exc:
        print(f"[SQL FAIL] {exc}")
        sys.exit(1)


# ============================================================
# SECTION C — Azure dev SQL state
# ============================================================


def _find_cost_center(
    db: Session, cost_center_name: Optional[str], cost_center_id: Optional[str]
) -> Optional[CostCenter]:
    """Locate a CostCenter by id (exact) or by name with exact-before-fuzzy preference.

    Priority for name lookup:
    1. Exact case-insensitive CostCenter.name
    2. Exact case-insensitive CostCenter.code
    3. Exact case-insensitive CostCenter.graph_department_name
    4. Fuzzy name ILIKE with single-match-only (aborts if multiple candidates)
    """
    if cost_center_id:
        return db.query(CostCenter).filter(CostCenter.id == cost_center_id).first()

    if not cost_center_name:
        return None

    name_lower = cost_center_name.lower()

    # 1. Exact name
    cc = db.query(CostCenter).filter(
        func.lower(CostCenter.name) == name_lower
    ).first()
    if cc:
        return cc

    # 2. Exact code
    cc = db.query(CostCenter).filter(
        func.lower(CostCenter.code) == name_lower
    ).first()
    if cc:
        return cc

    # 3. Exact graph_department_name
    cc = db.query(CostCenter).filter(
        func.lower(CostCenter.graph_department_name) == name_lower
    ).first()
    if cc:
        return cc

    # 4. Fuzzy fallback — abort if multiple candidates
    fuzzy_matches = db.query(CostCenter).filter(
        CostCenter.name.ilike(f"%{cost_center_name}%")
    ).all()
    if not fuzzy_matches:
        fuzzy_matches = db.query(CostCenter).filter(
            CostCenter.graph_department_name.ilike(f"%{cost_center_name}%")
        ).all()

    if len(fuzzy_matches) == 1:
        print(f"  [WARN] No exact match; using fuzzy match: '{fuzzy_matches[0].name}'")
        return fuzzy_matches[0]

    if len(fuzzy_matches) > 1:
        print(f"\n  ABORT: Fuzzy match for '{cost_center_name}' returned {len(fuzzy_matches)} candidates:")
        for m in fuzzy_matches:
            print(
                f"    id={m.id}  code={m.code}  name={m.name!r}  "
                f"graph_dept={m.graph_department_name!r}  location={m.location}  active={m.is_active}"
            )
        print("  Use a more specific --cost-center name, or --cost-center-id for exact lookup.")
        return None

    return None


def section_c(
    db: Session,
    cost_center_name: Optional[str] = None,
    cost_center_id: Optional[str] = None,
) -> tuple[Optional[CostCenter], list[User], list[Resource], dict[str, User]]:
    """
    Returns (cc, relevant_users, cc_resources, all_users_by_oid).
    relevant_users = CC members + target UPN users (deduplicated).
    """
    label = cost_center_id if cost_center_id else cost_center_name
    _sep(f"C. AZURE DEV SQL STATE  -  '{label}'")

    # ---- Find target CC ----
    cc: Optional[CostCenter] = _find_cost_center(db, cost_center_name, cost_center_id)

    if cc is None:
        print(f"\n  NOT FOUND: No CostCenter matching '{label}'.")
        print("  Active CCs in dev SQL:")
        for row in db.query(CostCenter).filter(CostCenter.is_active == True).all():
            print(
                f"    id={row.id}  code={row.code}  name={row.name!r}  "
                f"graph_dept={row.graph_department_name!r}  location={row.location}  active={row.is_active}"
            )
        return None, [], [], {}

    ro_user = db.query(User).filter(User.id == cc.ro_user_id).first() if cc.ro_user_id else None
    director = (
        db.query(User).filter(User.id == cc.director_user_id).first()
        if cc.director_user_id else None
    )

    cc_resource_count = db.query(Resource).filter(
        Resource.cost_center_id == cc.id,
        Resource.is_active == True,
    ).count()

    print(f"""
  CostCenter
    id                    = {cc.id}
    code                  = {cc.code}
    name                  = {cc.name!r}
    graph_department_name = {cc.graph_department_name!r}
    sync_protected        = {cc.sync_protected}
    is_active             = {cc.is_active}
    location              = {cc.location}
    ro_user_id            = {cc.ro_user_id}
    ro_user               = {_fmt_user(ro_user)}
    director_user_id      = {cc.director_user_id}
    director              = {_fmt_user(director)}
    active resource count = {cc_resource_count}""")

    # ---- All active resources in this CC ----
    cc_resources: list[Resource] = (
        db.query(Resource)
        .filter(Resource.cost_center_id == cc.id, Resource.is_active == True)
        .all()
    )

    # ---- Build global user lookups ----
    all_users: list[User] = db.query(User).filter(User.is_active == True).all()
    all_users_by_oid: dict[str, User] = {u.object_id: u for u in all_users if u.object_id}
    all_users_by_id: dict[str, User] = {u.id: u for u in all_users}

    # ---- Collect relevant users: CC members + target UPN users ----
    relevant_ids: set[str] = set()
    relevant_users: list[User] = []

    def _add_user(u: Optional[User]) -> None:
        if u and u.id not in relevant_ids:
            relevant_ids.add(u.id)
            relevant_users.append(u)

    # CC members via resources
    for res in cc_resources:
        if res.user_id:
            _add_user(all_users_by_id.get(res.user_id))

    # Users directly in CC (cost_center_id set)
    for u in db.query(User).filter(User.cost_center_id == cc.id, User.is_active == True).all():
        _add_user(u)

    # Target UPNs (case-insensitive)
    for upn in TARGET_UPNS:
        found = db.query(User).filter(User.email.ilike(upn)).first()
        _add_user(found)

    # ---- Resource lookup by user_id ----
    res_by_user_id: dict[str, Resource] = {}
    for res in cc_resources:
        if res.user_id:
            res_by_user_id[res.user_id] = res
    # Also check resources for target-UPN users outside CC
    extra_ids = [u.id for u in relevant_users if u.id not in res_by_user_id]
    if extra_ids:
        extra_res = (
            db.query(Resource).filter(Resource.user_id.in_(extra_ids)).all()
        )
        for r in extra_res:
            if r.user_id and r.user_id not in res_by_user_id:
                res_by_user_id[r.user_id] = r

    # ---- Print user / resource details ----
    print(f"\n  Relevant users ({len(relevant_users)} found — * = in target CC):")
    print(
        f"  {'*':<2}{'UPN / email':<32}{'display_name':<28}"
        f"{'role':<11}{'manager ->':<44}{'CC'}"
    )
    print(f"  {'-'*130}")

    for user in relevant_users:
        in_cc = "*" if user.cost_center_id == cc.id else " "
        mgr = all_users_by_oid.get(user.manager_object_id) if user.manager_object_id else None

        if mgr:
            mgr_label = f"{mgr.display_name} <{mgr.email}>"
        elif user.manager_object_id:
            mgr_label = f"OID:{user.manager_object_id} [NOT IN LOCAL DB]"
        else:
            mgr_label = "NULL"

        res = res_by_user_id.get(user.id)
        if res:
            cc_obj = db.query(CostCenter).filter(CostCenter.id == res.cost_center_id).first()
            cc_label = cc_obj.name[:22] if cc_obj else res.cost_center_id[:12]
        else:
            cc_label = "(no resource)"

        print(
            f"  {in_cc} {user.email:<32}{user.display_name[:27]:<28}"
            f"{user.role.value:<11}{_short(mgr_label, 43):<44}{cc_label}"
        )
        print(
            f"      local_id         = {user.id}"
        )
        print(
            f"      object_id        = {user.object_id}"
        )
        print(
            f"      manager_object_id= {user.manager_object_id}"
        )
        if res:
            print(
                f"      resource_id      = {res.id}"
                f"  resource_cc_id = {res.cost_center_id}"
            )
        else:
            print("      resource         = NONE")

    return cc, relevant_users, cc_resources, all_users_by_oid


# ============================================================
# SECTION D — Live Graph /manager for each user
# ============================================================

_USER_SELECT    = "id,displayName,userPrincipalName,mail,department,jobTitle,country"
_MANAGER_SELECT = "id,displayName,userPrincipalName,mail,department,jobTitle"


def _graph_get(token: str, url: str, params: dict) -> tuple[int, dict | str]:
    """Single Graph GET. Returns (status_code, body_dict_or_error_str)."""
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code in (200, 404):
                return resp.status_code, resp.json() if resp.status_code == 200 else {}
            return resp.status_code, resp.text[:300]
    except Exception as exc:
        return -1, f"EXCEPTION: {exc}"


def section_d(
    token: str,
    relevant_users: list[User],
    all_users_by_oid: dict[str, User],
) -> dict[str, dict]:
    """
    Returns graph_results: { user_object_id: { "user": {...}, "manager": {...}|"NO_MANAGER"|"ERROR:..." } }
    """
    _sep("D. LIVE GRAPH /manager DIAGNOSTICS")

    graph_results: dict[str, dict] = {}

    # Targets: prefer object_id (from SQL), fallback UPN for any not in SQL
    targets: list[tuple[str, str, Optional[str]]] = []  # (identifier, display_upn, sql_oid)
    seen_emails: set[str] = set()
    sql_by_email: dict[str, User] = {u.email.lower(): u for u in relevant_users}

    for user in relevant_users:
        targets.append((user.object_id, user.email, user.object_id))
        seen_emails.add(user.email.lower())

    for upn in TARGET_UPNS:
        if upn.lower() not in seen_emails:
            targets.append((upn, upn, None))
            seen_emails.add(upn.lower())

    print(f"\n  Querying {len(targets)} users from live Graph...")

    for identifier, display_upn, sql_oid in targets:
        entry: dict = {}

        # --- User profile ---
        status, body = _graph_get(
            token,
            f"{_GRAPH_BASE}/users/{identifier}",
            {"$select": _USER_SELECT},
        )
        if status == 200:
            entry["user"] = body
            confirmed_oid = body.get("id", identifier)
        elif status == 404:
            entry["user"] = "USER_NOT_FOUND"
            confirmed_oid = identifier
        elif status == 403:
            entry["user"] = f"PERMISSION_DENIED: {body}"
            confirmed_oid = identifier
        else:
            entry["user"] = f"ERROR status={status}: {body}"
            confirmed_oid = identifier

        # --- Manager ---
        if isinstance(entry["user"], dict):
            mgr_status, mgr_body = _graph_get(
                token,
                f"{_GRAPH_BASE}/users/{confirmed_oid}/manager",
                {"$select": _MANAGER_SELECT},
            )
            if mgr_status == 200:
                entry["manager"] = mgr_body
            elif mgr_status == 404:
                entry["manager"] = "NO_MANAGER"
            elif mgr_status == 403:
                entry["manager"] = f"PERMISSION_DENIED: {mgr_body}"
            else:
                entry["manager"] = f"ERROR status={mgr_status}: {mgr_body}"
        else:
            entry["manager"] = "N/A"

        # --- Print ---
        sql_user = sql_by_email.get(display_upn.lower())
        sql_mgr_oid = sql_user.manager_object_id if sql_user else "NOT_IN_SQL"

        gu = entry.get("user")
        gm = entry.get("manager")

        print(f"\n  -- {display_upn}")
        if isinstance(gu, dict):
            print(f"     Graph OID         : {gu.get('id')}")
            print(f"     displayName       : {gu.get('displayName')}")
            print(f"     userPrincipalName : {gu.get('userPrincipalName')}")
            print(f"     department        : {gu.get('department')}")
            print(f"     jobTitle          : {gu.get('jobTitle')}")
            print(f"     country           : {gu.get('country')}")
        else:
            print(f"     Graph user        : {gu}")

        print(f"     SQL manager_oid   : {sql_mgr_oid}")

        if isinstance(gm, dict):
            graph_mgr_oid = gm.get("id")
            print(f"     Graph manager OID : {graph_mgr_oid}")
            print(f"     Graph manager name: {gm.get('displayName')}")
            print(f"     Graph manager UPN : {gm.get('userPrincipalName')}")
            print(f"     Graph manager dept: {gm.get('department')}")
            print(f"     Graph manager job : {gm.get('jobTitle')}")

            # Flag mismatch between SQL and Graph
            if sql_mgr_oid and sql_mgr_oid not in ("NOT_IN_SQL",):
                if graph_mgr_oid != sql_mgr_oid:
                    print(
                        f"     *** MISMATCH: SQL manager_oid={sql_mgr_oid} "
                        f"but Graph says={graph_mgr_oid}"
                    )
                    # Resolve names for readability
                    sql_mgr_user = all_users_by_oid.get(sql_mgr_oid)
                    graph_mgr_local = all_users_by_oid.get(graph_mgr_oid) if graph_mgr_oid else None
                    if sql_mgr_user:
                        print(f"              SQL manager resolved  : {sql_mgr_user.display_name}")
                    if graph_mgr_local:
                        print(f"              Graph manager resolved: {graph_mgr_local.display_name}")
                else:
                    print(f"     SQL == Graph manager OID: MATCH")
        else:
            print(f"     Graph manager     : {gm}")

        key = gu.get("id") if isinstance(gu, dict) else identifier
        graph_results[key] = entry
        # Also store under UPN for cross-lookup
        graph_results[display_upn.lower()] = entry

    return graph_results


# ============================================================
# SECTION E — directReports (optional)
# ============================================================


def section_e(token: str, relevant_users: list[User]) -> None:
    _sep("E. DIRECT REPORTS (OPTIONAL)")

    sql_by_email: dict[str, User] = {u.email.lower(): u for u in relevant_users}
    _DR_SELECT = "id,displayName,userPrincipalName,mail,department,jobTitle"

    for upn in DIRECT_REPORTS_UPNS:
        user = sql_by_email.get(upn.lower())
        identifier = user.object_id if (user and user.object_id) else upn
        mode = "OID" if (user and user.object_id) else "UPN"

        print(f"\n  directReports for {upn}  (using {mode}={identifier[:12]}...)")
        status, body = _graph_get(
            token,
            f"{_GRAPH_BASE}/users/{identifier}/directReports",
            {"$select": _DR_SELECT},
        )
        if status == 200:
            reports = body.get("value", [])
            print(f"    Count: {len(reports)}")
            for r in reports:
                print(
                    f"    - {r.get('displayName'):<28} "
                    f"UPN={r.get('userPrincipalName')}  "
                    f"dept={r.get('department')}  "
                    f"title={r.get('jobTitle')}"
                )
        elif status == 404:
            print("    USER NOT FOUND (404)")
        elif status == 403:
            print(f"    PERMISSION DENIED (403) — app may lack Organization.Read.All or User.Read.All")
            print(f"    Error: {body}")
        else:
            print(f"    ERROR status={status}: {body}")


# ============================================================
# SECTION F — Compare dev SQL vs live Graph
# ============================================================


def section_f(
    db: Session,
    cc: Optional[CostCenter],
    cc_resources: list[Resource],
    graph_results: dict,
    all_users_by_oid: dict[str, User],
) -> dict:
    _sep("F. AZURE DEV SQL vs LIVE GRAPH - COMPARISON")

    if cc is None:
        print("  Skipped — target CC not found.")
        return {}

    all_users_by_id: dict[str, User] = {
        u.id: u
        for u in db.query(User).filter(User.is_active == True).all()
    }

    print(
        f"\n  {'Resource':<28} "
        f"{'Dev SQL Manager':<28} "
        f"{'Graph Manager':<28} "
        f"{'Match?':<8} "
        f"Notes"
    )
    print(f"  {'-'*130}")

    summary = dict(
        total=0, match=0, mismatch=0,
        local_stale=0, graph_no_manager=0,
        local_null_manager=0, graph_id_mismatch=0,
        upn_case_only=0,
    )
    rows: list[dict] = []

    for resource in cc_resources:
        user = all_users_by_id.get(resource.user_id) if resource.user_id else None
        if not user:
            print(f"  {resource.display_name[:27]:<28} [NO USER LINKED TO RESOURCE]")
            continue

        summary["total"] += 1

        sql_mgr_oid = user.manager_object_id
        sql_mgr = all_users_by_oid.get(sql_mgr_oid) if sql_mgr_oid else None
        sql_label = sql_mgr.display_name[:25] if sql_mgr else (
            f"OID:{sql_mgr_oid[:12]}..." if sql_mgr_oid else "NULL"
        )

        # Look up graph entry by OID, then by email
        gentry = graph_results.get(user.object_id) or graph_results.get(user.email.lower())
        notes: list[str] = []
        graph_label = "NOT_FETCHED"
        match = "?"

        if gentry is None:
            graph_label = "NOT_FETCHED"
            notes.append("USER_NOT_IN_GRAPH_RESULTS")
            match = "?"
        else:
            gm = gentry.get("manager")
            if gm == "NO_MANAGER":
                graph_label = "NO_MANAGER"
                summary["graph_no_manager"] += 1
                notes.append("GRAPH_NO_MANAGER")
                if sql_mgr_oid:
                    notes.append("LOCAL_STALE")
                    summary["local_stale"] += 1
                match = "NO"
                summary["mismatch"] += 1
            elif isinstance(gm, dict):
                graph_mgr_oid = gm.get("id")
                graph_mgr_name = gm.get("displayName", "?")
                graph_label = graph_mgr_name[:25]
                graph_mgr_local = all_users_by_oid.get(graph_mgr_oid) if graph_mgr_oid else None

                if not sql_mgr_oid:
                    notes.append("LOCAL_NULL_MANAGER")
                    summary["local_null_manager"] += 1
                    notes.append("LOCAL_STALE")
                    summary["local_stale"] += 1
                    match = "NO"
                    summary["mismatch"] += 1
                elif sql_mgr_oid == graph_mgr_oid:
                    match = "YES"
                    summary["match"] += 1
                elif sql_mgr_oid.lower() == graph_mgr_oid.lower():
                    match = "CASE"
                    summary["match"] += 1
                    summary["upn_case_only"] += 1
                    notes.append("UPN_CASE_ONLY_DIFFERENCE")
                else:
                    match = "NO"
                    summary["mismatch"] += 1
                    summary["local_stale"] += 1
                    summary["graph_id_mismatch"] += 1
                    notes.append("GRAPH_ID_MISMATCH")
                    notes.append("LOCAL_STALE")
                    if sql_mgr:
                        notes.append(
                            f"SQL={sql_mgr.display_name[:12].upper().replace(' ','_')}"
                        )
                    if graph_mgr_local:
                        notes.append(
                            f"GRAPH={graph_mgr_local.display_name[:12].upper().replace(' ','_')}"
                        )
                    else:
                        notes.append(f"GRAPH_MGR_NOT_IN_LOCAL_DB")
            else:
                graph_label = str(gm)[:25]
                match = "ERR"
                notes.append("GRAPH_ERROR")

        notes_str = " | ".join(notes)
        print(
            f"  {resource.display_name[:27]:<28} "
            f"{sql_label:<28} "
            f"{graph_label:<28} "
            f"{match:<8} "
            f"{notes_str}"
        )
        rows.append(dict(
            resource=resource.display_name,
            user_oid=user.object_id,
            sql_mgr_oid=sql_mgr_oid,
            sql_mgr_name=sql_mgr.display_name if sql_mgr else None,
            graph_mgr_oid=(
                gentry.get("manager", {}).get("id")
                if gentry and isinstance(gentry.get("manager"), dict) else None
            ),
            graph_mgr_name=(
                gentry.get("manager", {}).get("displayName")
                if gentry and isinstance(gentry.get("manager"), dict) else None
            ),
            match=match,
            notes=notes,
        ))

    print(f"""
  Summary:
    Total checked      : {summary['total']}
    Matches            : {summary['match']}
    Mismatches         : {summary['mismatch']}
    Local stale        : {summary['local_stale']}
    Graph no manager   : {summary['graph_no_manager']}
    Local null manager : {summary['local_null_manager']}
    Graph ID mismatch  : {summary['graph_id_mismatch']}
    UPN case-only diff : {summary['upn_case_only']}""")

    return {"summary": summary, "rows": rows}


# ============================================================
# SECTION G — batch_get_managers vs direct /manager
# ============================================================


def section_g(
    settings: Settings,
    graph_results: dict,
    relevant_users: list[User],
    db: Session,
    all_users_by_oid: dict[str, User],
) -> None:
    _sep("G. DIRECT /manager vs batch_get_managers COMPARISON")

    target_oids = [u.object_id for u in relevant_users if u.object_id]
    if not target_oids:
        print("  No OIDs — skipped.")
        return

    print(f"\n  Calling batch_get_managers for {len(target_oids)} OIDs...")
    graph_client = GraphAppClient(settings)
    batch: dict = graph_client.batch_get_managers(target_oids)

    if not batch:
        print("  batch_get_managers returned empty — credentials may be wrong.")
        return

    print(f"  batch_get_managers returned {len(batch)} entries.\n")

    upn_by_oid: dict[str, str] = {u.object_id: u.email for u in relevant_users if u.object_id}

    print(
        f"  {'User UPN':<32} "
        f"{'Direct /manager':<32} "
        f"{'batch_get_managers':<32} "
        f"Match?"
    )
    print(f"  {'-'*110}")

    mismatches = 0
    checked = 0

    for oid in target_oids:
        upn = upn_by_oid.get(oid, oid[:16] + "...")

        # Direct result (from section D, keyed by OID)
        gentry = graph_results.get(oid)
        if gentry and isinstance(gentry.get("manager"), dict):
            direct_oid = gentry["manager"].get("id")
        elif gentry and gentry.get("manager") == "NO_MANAGER":
            direct_oid = None
        else:
            direct_oid = "NOT_FETCHED"

        batch_oid = batch.get(oid, "NOT_IN_BATCH")

        def _resolve_name(o) -> str:
            if o in (None, "NOT_FETCHED", "NOT_IN_BATCH"):
                return str(o)
            u = all_users_by_oid.get(o)
            return f"{u.display_name[:20]} ({o[:8]}...)" if u else f"NOT_LOCAL ({o[:8]}...)"

        if direct_oid == "NOT_FETCHED":
            match_str = "?"
        elif str(direct_oid) == str(batch_oid):
            match_str = "YES"
        else:
            match_str = "NO *** MISMATCH"
            mismatches += 1

        checked += 1
        print(
            f"  {upn:<32} "
            f"{_resolve_name(direct_oid):<32} "
            f"{_resolve_name(batch_oid):<32} "
            f"{match_str}"
        )

    print(f"\n  Result: {checked} users checked, {mismatches} batch-vs-direct mismatches.\n")

    if mismatches > 0:
        print("  *** BATCH_MAPPING_BUG DETECTED ***")
        print("  batch_get_managers returns different manager OIDs than direct /manager calls.")
        print("  Suspects in graph_app_client.py batch_get_managers:")
        print("    - Request IDs use raw OID strings (correct per code inspection).")
        print("    - But if Graph returns OIDs in different casing, oid lookup would mismatch.")
        print("    - Or if a batch response body is malformed (missing 'id'), oid defaults wrong.")
        print("    - Check: does `item.get('id')` return the user OID or the manager OID?")
        print("      It SHOULD be the user OID (the request ID we sent). If Graph wraps it")
        print("      differently, it could be mapped to the wrong user.")
    else:
        print("  batch_get_managers matches direct /manager — batch logic is correct.")

    # ---- Code-level analysis ----
    print("\n  Code-level analysis of batch_get_managers (no mutations):")
    print("  - Uses 'id': oid as request ID (OID string, not sequential int) — CORRECT")
    print("  - Parses response: oid = item.get('id')  → this is the REQUEST ID (user OID) — CORRECT")
    print("  - result[oid] = body.get('id')           → maps user_oid → manager_oid — CORRECT")
    print("  - 404 → result[oid] = None               → correctly marks no-manager — CORRECT")
    print("  - Missing batch entries (chunk call failed) → key absent in result — CORRECT")
    print("  Contrast: list_all_managers uses str(i+1) as request ID (sequential) but only")
    print("  collects manager OIDs into a set — correctness unaffected by ID scheme.")


# ============================================================
# SECTION H — assign_cost_center_managers dry-run
# ============================================================


def section_h(db: Session, cc: Optional[CostCenter]) -> None:
    _sep("H. assign_cost_center_managers DRY-RUN  (no writes)")

    if cc is None:
        print("  Skipped — target CC not found.")
        return

    if cc.sync_protected:
        print(f"  SKIPPED — CC '{cc.name}' has sync_protected=True.")
        print("  assign_cost_center_managers always skips protected CCs.")
        return

    # Replicate the exact data structures from the real function
    users_by_object_id: dict[str, User] = {
        u.object_id: u
        for u in db.query(User).filter(User.is_active == True).all()
    }

    cc_users: list[User] = (
        db.query(User)
        .filter(User.cost_center_id == cc.id, User.is_active == True)
        .all()
    )

    print(f"\n  CC '{cc.name}'  ({len(cc_users)} active users)")
    print(f"  Current ro_user_id      = {cc.ro_user_id}")
    print(f"  Current director_user_id= {cc.director_user_id}")

    if not cc_users:
        print("  SKIPPED — no active users in CC.")
        return

    print(f"\n  Active CC users (in query order — ORDER MATTERS for second-pass selection):")
    for i, u in enumerate(cc_users):
        mgr = users_by_object_id.get(u.manager_object_id) if u.manager_object_id else None
        same_cc = " [SAME CC]" if (mgr and mgr.cost_center_id == cc.id) else ""
        mgr_label = f"{mgr.display_name}{same_cc}" if mgr else (
            f"OID:{u.manager_object_id[:12]}... [NOT IN DB]" if u.manager_object_id else "NO MGR OID"
        )
        print(f"    [{i}] {u.display_name:<26} role={u.role.value:<10} manager-> {mgr_label}")

    # ---- _find_ro_candidate trace ----
    print(f"\n  === _find_ro_candidate trace ===\n")
    non_mgr_users = [u for u in cc_users if u.role not in _MANAGER_ROLES]
    first_pass_users = non_mgr_users if non_mgr_users else cc_users

    print(f"  FIRST PASS — walk full manager chain from {len(first_pass_users)} non-manager user(s).")
    print("  Goal: find a manager whose cost_center_id == this CC (= the natural RO).\n")

    ro_candidate: Optional[User] = None
    first_pass_hit = False

    for user in first_pass_users:
        visited: set[str] = {user.object_id}
        oid = user.manager_object_id
        depth = 0
        print(f"  Chain from [{user.display_name}]  role={user.role.value}")

        while oid and oid not in visited:
            visited.add(oid)
            mgr = users_by_object_id.get(oid)
            depth += 1

            if mgr:
                in_same_cc = mgr.cost_center_id == cc.id
                marker = " <- SAME CC - RO CANDIDATE" if in_same_cc else ""
                print(
                    f"    depth={depth}: {mgr.display_name:<26} "
                    f"role={mgr.role.value:<10} "
                    f"cc={'SAME' if in_same_cc else 'DIFF'}{marker}"
                )
                if in_same_cc:
                    ro_candidate = mgr
                    first_pass_hit = True
                    break
                oid = mgr.manager_object_id
            else:
                print(f"    depth={depth}: OID={oid} — NOT IN LOCAL DB (chain ends)")
                break

        if first_pass_hit:
            print(f"\n  FIRST PASS RESULT: {ro_candidate.display_name} selected as RO candidate.")
            break
        else:
            print(f"  (no same-CC manager found from {user.display_name})")

    if not first_pass_hit:
        print(f"\n  FIRST PASS: no same-CC manager found.")
        print(f"\n  SECOND PASS — look ONE level up from each CC user (any DB manager).")
        print("  *** NOTE: the while loop always BREAKs after the first iteration. ***")
        print("  *** This means only the IMMEDIATE manager of each user is checked. ***")
        print("  *** The USER ORDER from db.query() determines who is selected first. ***\n")

        for user in cc_users:
            oid = user.manager_object_id
            if not oid:
                print(f"  [{user.display_name}] — no manager_object_id → skip")
                continue

            mgr = users_by_object_id.get(oid)
            print(f"  [{user.display_name}] → manager OID {oid[:12]}...")
            if mgr:
                print(
                    f"    Found in DB: {mgr.display_name}  role={mgr.role.value}"
                    f"  <- SELECTED AS RO CANDIDATE (second pass, first hit)"
                )
                ro_candidate = mgr
                break
            else:
                print(f"    NOT IN LOCAL DB → break (only one level checked per user)")
                # Mirrors the code's `break` inside the while loop when mgr is None

    # ---- RO decision ----
    print(f"\n  === RO DECISION ===")
    print(f"  RO candidate        : {_fmt_user(ro_candidate)}")
    print(f"  Current ro_user_id  : {cc.ro_user_id}")

    if ro_candidate is None:
        print("  OUTCOME: No RO candidate found. ro_user_id stays unchanged.")
    elif cc.ro_user_id is None:
        print(
            f"  OUTCOME (force=False): ro_user_id is NULL → WOULD SET to {ro_candidate.display_name}"
        )
    elif ro_candidate.id == cc.ro_user_id:
        print("  OUTCOME: Same candidate already set. No change.")
    else:
        print(
            f"  OUTCOME (force=False): ro_user_id is NOT NULL → WOULD NOT OVERWRITE."
        )
        print(
            f"  OUTCOME (force=True) : WOULD overwrite with {ro_candidate.display_name}"
        )

    # ---- Director decision ----
    print(f"\n  === DIRECTOR DECISION ===")
    if ro_candidate and ro_candidate.manager_object_id:
        director_candidate = users_by_object_id.get(ro_candidate.manager_object_id)
        print(f"  RO candidate's manager_object_id : {ro_candidate.manager_object_id}")
        print(f"  Director candidate               : {_fmt_user(director_candidate)}")
        print(f"  Current director_user_id         : {cc.director_user_id}")

        if director_candidate is None:
            print("  OUTCOME: Director OID not found in local DB. director_user_id not set.")
        elif cc.director_user_id is None:
            print(f"  OUTCOME (force=False): director is NULL → WOULD SET to {director_candidate.display_name}")
        elif director_candidate.id == cc.director_user_id:
            print("  OUTCOME: Same director already set. No change.")
        else:
            print(f"  OUTCOME (force=False): director NOT NULL → WOULD NOT OVERWRITE.")
            print(f"  OUTCOME (force=True) : WOULD overwrite with {director_candidate.display_name}")
    elif ro_candidate:
        print(f"  RO candidate ({ro_candidate.display_name}) has NO manager_object_id.")
        print("  Director cannot be set from RO's manager chain.")
    else:
        print("  No RO candidate → Director lookup skipped.")


# ============================================================
# SECTION I — Root cause classification
# ============================================================


def section_i(
    comparison: dict,
    cc: Optional[CostCenter],
    db: Session,
    all_users_by_oid: dict[str, User],
) -> None:
    _sep("I. ROOT CAUSE CLASSIFICATION")

    if not comparison or cc is None:
        print("  Insufficient data. Check earlier sections.")
        return

    s = comparison.get("summary", {})
    rows = comparison.get("rows", [])
    total = s.get("total", 0)
    matches = s.get("match", 0)
    mismatches = s.get("mismatch", 0)
    local_stale = s.get("local_stale", 0)
    graph_no_manager = s.get("graph_no_manager", 0)
    graph_id_mismatch = s.get("graph_id_mismatch", 0)

    print(f"""
  Data:  total={total}  match={matches}  mismatch={mismatches}
         local_stale={local_stale}  graph_no_manager={graph_no_manager}

  Evaluating each hypothesis:""")

    # ---- H1: GRAPH_SOURCE_DATA ----
    graph_mgr_names = [r["graph_mgr_name"] for r in rows if r.get("graph_mgr_name")]
    print(f"""
  [1] GRAPH_SOURCE_DATA
      Live Graph manager names seen: {sorted(set(graph_mgr_names))}
      SQL matches Graph?  {matches}/{total}
      IF matches == total AND Graph says wrong manager → source data is wrong.
      Action: correct the org chart in Entra, then re-sync.
      Likelihood: {"HIGH — SQL matches Graph" if mismatches == 0 and total > 0 else "LOW — SQL/Graph differ, sync is the issue"}""")

    # ---- H2: DEV_SQL_STALE ----
    print(f"""
  [2] DEV_SQL_STALE
      Local stale count: {local_stale}/{total}
      IF SQL manager_object_id differs from Graph manager id → sync hasn't run or failed.
      Cause: batch_get_managers call may have failed silently, or run_graph_sync was skipped.
      Action: trigger /sync/graph-users on dev App Service, then /sync/assign-cost-center-managers?force=true
      Likelihood: {"HIGH" if local_stale > total // 2 and total > 0 else "LOW" if local_stale == 0 else "MEDIUM"}""")

    # ---- H3: BATCH_MAPPING_BUG ----
    print(f"""
  [3] BATCH_MAPPING_BUG
      See Section G output.
      IF direct /manager OIDs ≠ batch_get_managers OIDs → batch response ID mishandled.
      Code inspection shows batch_get_managers uses OID as request ID and maps by it.
      This is correct. The bug would appear only if Graph returns unexpected response shapes.
      Likelihood: LOW based on code — confirm with Section G numbers.""")

    # ---- H4: LOCAL_USER_RESOLUTION_BUG ----
    print(f"""
  [4] LOCAL_USER_RESOLUTION_BUG
      Graph returns correct manager OID, but users_by_object_id.get(oid) returns None.
      This would happen if the manager's object_id in the DB is stored with different
      case or extra whitespace vs what Graph returns.
      Check: SELECT object_id FROM users WHERE email ILIKE 'katja%' or similar.
      SQL Server: String(36) columns are case-INsensitive by default (Latin1_General_CI_AS).
      Likelihood: LOW (SQL Server CI collation makes this unlikely).""")

    # ---- H5: ASSIGNMENT_ALGORITHM_BUG ----
    print(f"""
  [5] ASSIGNMENT_ALGORITHM_BUG
      SQL manager data is correct, but _find_ro_candidate picks the wrong user.
      CRITICAL FINDING in second pass code (background_sync.py:124-133):

          for user in cc_users:              # iterates ALL cc users
              visited = {{user.object_id}}
              oid = user.manager_object_id
              while oid and oid not in visited:
                  visited.add(oid)
                  mgr = users_by_object_id.get(oid)
                  if mgr:
                      return mgr            # returns FIRST manager found in DB
                  break                     # ← ALWAYS fires, even if mgr is None

      The `break` exits after ONE step up the chain for each user.
      The first cc_user whose direct manager_object_id resolves to ANY db user → selected.
      If that user's manager is not the intended RO, the wrong person is selected.
      The ORDER of db.query(User).filter(cost_center_id==cc.id) determines who wins.
      Likelihood: {"HIGH — check Section H dry-run to see who was selected and why" if total > 0 else "UNKNOWN"}""")

    # ---- Most likely ----
    print(f"\n  === MOST LIKELY ROOT CAUSE ===")
    if total == 0:
        print("  No resources found in comparison — cannot classify. Check CC name and DB state.")
    elif mismatches == 0 and matches == total:
        print(
            "  SQL and Graph agree on manager OIDs.\n"
            "  Root cause is either:\n"
            "    -> GRAPH_SOURCE_DATA (Graph org chart itself is wrong)\n"
            "    -> ASSIGNMENT_ALGORITHM_BUG (SQL is correct but second-pass picks wrong RO)\n"
            "  Check Section H dry-run: who was selected as RO candidate, and why?\n"
            "  If second-pass selected wrong person due to DB row order -> H5 confirmed."
        )
    elif local_stale == total and total > 0:
        print(
            "  ALL resources have stale SQL manager data.\n"
            "  Root cause: DEV_SQL_STALE.\n"
            "  run_graph_sync (Step 2) has not updated manager_object_id in dev.\n"
            "  Fix: run /sync/graph-users on matkat-api-dev, then /sync/assign-cost-center-managers?force=true."
        )
    elif local_stale > 0:
        print(
            f"  {local_stale}/{total} resources stale.\n"
            "  Partial DEV_SQL_STALE. Run /sync/graph-users on dev to refresh."
        )
    elif graph_no_manager > 0:
        print(
            f"  {graph_no_manager} resources have no manager in Graph.\n"
            "  If the intended manager (e.g. Katja) shows NO_MANAGER in Graph → GRAPH_SOURCE_DATA.\n"
            "  Entra org chart needs correction."
        )
    else:
        print(
            "  Mixed signals — review Section G batch comparison and Section H dry-run carefully.\n"
            "  Use the per-row notes in Section F to identify the dominant pattern."
        )

    print(f"""
  === RECOMMENDED NEXT STEPS (do not implement yet) ===
  1. Check Section D: note what name Graph /manager returns for each Biomaterial R&D user.
  2. Check Section G: confirm batch_get_managers matches direct calls.
  3. Check Section H: note which user was selected as RO in the second pass, and in what DB order.
  4. If stale SQL: run only /sync/graph-users (Step 2) on dev App Service, then re-run this script.
  5. If wrong RO selection: consider whether force=True + correct SQL data would fix it,
     or if the second-pass break logic needs fixing for the specific CC structure.
  6. DO NOT run full sync or mutate anything until root cause is confirmed.""")


# ============================================================
# Main
# ============================================================


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MatKat DEV Graph hierarchy diagnostic — READ ONLY"
    )
    parser.add_argument(
        "--cost-center",
        default=None,
        help='Target cost center name (exact or fuzzy), e.g. "Biomaterial R&D"',
    )
    parser.add_argument(
        "--cost-center-id",
        default=None,
        help="Target cost center UUID for exact id lookup, e.g. 89ea0670-9b2f-4e58-a664-069264ebdbe8",
    )
    args = parser.parse_args()

    if not args.cost_center and not args.cost_center_id:
        parser.error("Provide --cost-center NAME or --cost-center-id UUID")

    cost_center_name: Optional[str] = args.cost_center
    cost_center_id: Optional[str] = args.cost_center_id
    label = cost_center_id if cost_center_id else cost_center_name

    _sep("MatKat DEV — Graph Hierarchy Diagnostic")
    print(f"  Target cost center : {label!r}")
    if cost_center_id:
        print(f"  Lookup mode        : exact id")
    else:
        print(f"  Lookup mode        : name (exact-then-fuzzy)")
    print(f"  Target UPNs        : {len(TARGET_UPNS)}")
    print(f"  Mode               : READ-ONLY — no DB writes, no sync triggered")
    print(f"  UTC timestamp      : {datetime.now(timezone.utc).isoformat()}")

    # ---- Load settings ----
    settings = _load_settings()
    graph_ok = bool(
        settings.graph_client_id
        and settings.graph_client_secret
        and settings.azure_tenant_id
    )

    # ---- Connect DB ----
    _sep("Connecting to Azure dev SQL")
    db = _connect_db()

    try:
        # C — SQL state
        cc, relevant_users, cc_resources, all_users_by_oid = section_c(
            db, cost_center_name=cost_center_name, cost_center_id=cost_center_id
        )

        # Token
        token: Optional[str] = None
        if graph_ok:
            _sep("Acquiring Graph token")
            token = _acquire_token(settings)
        else:
            print("\n[SKIP] Graph sections — credentials not set.")

        graph_results: dict = {}

        # D — Graph /manager
        if token:
            if relevant_users:
                graph_results = section_d(token, relevant_users, all_users_by_oid)
            else:
                _sep("D. LIVE GRAPH /manager DIAGNOSTICS")
                print("  No SQL users found — skipped.")

        # E — directReports
        if token and relevant_users:
            section_e(token, relevant_users)

        # F — Compare
        comparison: dict = {}
        if cc_resources:
            comparison = section_f(db, cc, cc_resources, graph_results, all_users_by_oid)
        else:
            _sep("F. AZURE DEV SQL vs LIVE GRAPH - COMPARISON")
            print("  No CC resources — skipped.")

        # G — Batch vs direct
        if token and relevant_users:
            section_g(settings, graph_results, relevant_users, db, all_users_by_oid)
        elif token:
            _sep("G. DIRECT /manager vs batch_get_managers COMPARISON")
            print("  No SQL users — skipped.")

        # H — Dry-run
        section_h(db, cc)

        # I — Root cause
        section_i(comparison, cc, db, all_users_by_oid)

        _sep("DIAGNOSTIC COMPLETE — no data was written")

    finally:
        db.close()


if __name__ == "__main__":
    main()
