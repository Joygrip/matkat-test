"""Read-only diagnostic: audit cost center manager assignment state.

Run from repo root:
    python -m api.app.scripts.diagnose_cc_managers [--tenant TENANT_ID] [--db PATH]

Outputs:
  A. Target user state (Katja or any --user email)
  B. CostCenter state for target department
  C. All CCs missing RO or Director (active, non-protected)
  D. Directors/Managers in Graph that are NOT assigned as RO or Director on any CC
  E. CCs where graph_department_name IS NULL (invisible to Graph sync)
  F. Department name near-matches between Graph and CostCenter records
  G. Manager chain coverage per CC
  H. Sync log summary (if available via SyncResult)

IMPORTANT: This script is read-only. It never writes to the database.
"""
import argparse
import re
import sys
import os


def normalize_name(name: str) -> str:
    """Normalize a department name for fuzzy comparison."""
    if not name:
        return ""
    s = name.strip().lower()
    s = re.sub(r'\s+', ' ', s)
    s = s.replace(' and ', ' & ')
    return s


def run_diagnostic(db_path: str, tenant_id: str | None, target_email: str | None) -> None:
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Resolve tenant
    if tenant_id is None:
        c.execute("SELECT DISTINCT tenant_id FROM users LIMIT 5")
        tenants = [r[0] for r in c.fetchall()]
        if not tenants:
            print("ERROR: no users found in database")
            return
        if len(tenants) > 1:
            print(f"Multiple tenants found: {tenants}")
            print("Use --tenant TENANT_ID to specify one.")
            return
        tenant_id = tenants[0]

    print(f"\n{'='*70}")
    print(f"TENANT: {tenant_id}")
    print(f"DATABASE: {db_path}")
    print(f"{'='*70}\n")

    # ----------------------------------------------------------------
    # A. Target user
    # ----------------------------------------------------------------
    email = target_email or "kahi@ferrosanmd.com"
    print(f"{'='*60}")
    print(f"A. TARGET USER: {email}")
    print(f"{'='*60}")

    c.execute("""
        SELECT u.id, u.object_id, u.email, u.display_name, u.role,
               u.manager_object_id, u.cost_center_id, u.country, u.is_active,
               cc.name as cc_name, cc.graph_department_name
        FROM users u
        LEFT JOIN cost_centers cc ON cc.id = u.cost_center_id
        WHERE u.tenant_id = ?
          AND (LOWER(u.email) = LOWER(?)
               OR LOWER(u.email) LIKE LOWER(?)
               OR LOWER(u.display_name) LIKE LOWER(?))
    """, (tenant_id, email, f"%{email.split('@')[0]}%",
          f"%{email.split('@')[0].replace('.', '%')}%"))
    users = c.fetchall()

    if not users:
        print(f"  No user row found matching '{email}'")
        print("  → user.id: MISSING")
        print("  → This user has never been imported to MatKat.")
        print("  → Check: has import_users_from_graph run? Is accountEnabled=true in Entra?")
    else:
        for u in users:
            print(f"  id:               {u['id']}")
            print(f"  object_id:        {u['object_id']}")
            print(f"  email:            {u['email']}")
            print(f"  display_name:     {u['display_name']}")
            print(f"  role:             {u['role']}")
            print(f"  is_active:        {u['is_active']}")
            print(f"  manager_object_id:{u['manager_object_id']}")
            print(f"  cost_center_id:   {u['cost_center_id']}")
            print(f"  cost_center_name: {u['cc_name']}")
            print(f"  graph_dept_name:  {u['graph_department_name']}")
            print(f"  country:          {u['country']}")

            # Check if this user is RO or Director on any CC
            c2 = conn.cursor()
            c2.execute("""
                SELECT id, name, is_active, sync_protected
                FROM cost_centers
                WHERE tenant_id = ? AND (ro_user_id = ? OR director_user_id = ?)
            """, (tenant_id, u['id'], u['id']))
            cc_roles = c2.fetchall()
            if cc_roles:
                print(f"  assigned as RO/Director on CCs:")
                for cr in cc_roles:
                    c2.execute("""
                        SELECT
                            CASE WHEN ro_user_id = ? THEN 'RO' ELSE '' END as is_ro,
                            CASE WHEN director_user_id = ? THEN 'Director' ELSE '' END as is_dir
                        FROM cost_centers WHERE id = ?
                    """, (u['id'], u['id'], cr['id']))
                    role_row = c2.fetchone()
                    roles = [r for r in [role_row['is_ro'], role_row['is_dir']] if r]
                    print(f"    [{', '.join(roles)}] {cr['name']} (active={cr['is_active']})")
            else:
                print(f"  assigned as RO/Director on CCs: NONE")
                print(f"  → This user is NOT assigned as RO or Director on any cost center.")

            # Check Resource row
            c2.execute("""
                SELECT r.id, r.cost_center_id, r.resource_type, r.is_active,
                       cc.name as cc_name
                FROM resources r
                LEFT JOIN cost_centers cc ON cc.id = r.cost_center_id
                WHERE r.tenant_id = ? AND r.user_id = ?
            """, (tenant_id, u['id']))
            resources = c2.fetchall()
            if resources:
                print(f"  resource rows:")
                for res in resources:
                    print(f"    id={res['id']} cc='{res['cc_name']}' type={res['resource_type']} active={res['is_active']}")
            else:
                print(f"  resource rows: NONE")
            print()

    # ----------------------------------------------------------------
    # B. CostCenter for target department
    # ----------------------------------------------------------------
    dept_pattern = "biomaterial"
    print(f"{'='*60}")
    print(f"B. COST CENTERS MATCHING '{dept_pattern}'")
    print(f"{'='*60}")
    c.execute("""
        SELECT cc.id, cc.name, cc.code, cc.graph_department_name,
               cc.ro_user_id, cc.director_user_id, cc.location,
               cc.sync_protected, cc.is_active,
               ro.display_name as ro_name, ro.email as ro_email,
               dir.display_name as dir_name, dir.email as dir_email,
               (SELECT COUNT(*) FROM users u2 WHERE u2.cost_center_id = cc.id AND u2.is_active = 1) as user_count,
               (SELECT COUNT(*) FROM resources r WHERE r.cost_center_id = cc.id AND r.is_active = 1) as resource_count
        FROM cost_centers cc
        LEFT JOIN users ro ON ro.id = cc.ro_user_id
        LEFT JOIN users dir ON dir.id = cc.director_user_id
        WHERE cc.tenant_id = ?
          AND (LOWER(cc.name) LIKE ? OR LOWER(cc.graph_department_name) LIKE ?)
    """, (tenant_id, f"%{dept_pattern}%", f"%{dept_pattern}%"))
    ccs = c.fetchall()

    if not ccs:
        print(f"  No cost centers found matching '{dept_pattern}'")
        print("  → The cost center may not exist, or the department name is different.")
    else:
        for cc in ccs:
            print(f"  id:                   {cc['id']}")
            print(f"  name:                 {cc['name']}")
            print(f"  code:                 {cc['code']}")
            print(f"  graph_department_name:{cc['graph_department_name']}")
            print(f"  is_active:            {cc['is_active']}")
            print(f"  sync_protected:       {cc['sync_protected']}")
            print(f"  ro_user_id:           {cc['ro_user_id']} ({cc['ro_name']} / {cc['ro_email']})")
            print(f"  director_user_id:     {cc['director_user_id']} ({cc['dir_name']} / {cc['dir_email']})")
            print(f"  location:             {cc['location']}")
            print(f"  active_users_in_cc:   {cc['user_count']}")
            print(f"  active_resources:     {cc['resource_count']}")
            if cc['graph_department_name'] is None:
                print(f"  *** WARNING: graph_department_name is NULL")
                print(f"      → Sync cannot match Graph users to this CC by department.")
                print(f"      → A new duplicate CC may be created during sync.")
            print()

    # ----------------------------------------------------------------
    # C. All active CCs missing RO or Director
    # ----------------------------------------------------------------
    print(f"{'='*60}")
    print(f"C. ACTIVE, NON-PROTECTED CCs MISSING RO OR DIRECTOR")
    print(f"{'='*60}")
    c.execute("""
        SELECT cc.id, cc.name, cc.graph_department_name,
               cc.ro_user_id, cc.director_user_id,
               (SELECT COUNT(*) FROM users u2 WHERE u2.cost_center_id = cc.id AND u2.is_active = 1) as user_count
        FROM cost_centers cc
        WHERE cc.tenant_id = ?
          AND cc.is_active = 1
          AND cc.sync_protected = 0
          AND (cc.ro_user_id IS NULL OR cc.director_user_id IS NULL)
        ORDER BY cc.name
    """, (tenant_id,))
    missing = c.fetchall()
    print(f"  Count: {len(missing)}")
    for m in missing:
        missing_fields = []
        if m['ro_user_id'] is None:
            missing_fields.append("RO")
        if m['director_user_id'] is None:
            missing_fields.append("Director")
        gdn = m['graph_department_name'] or "NULL"
        print(f"  [{', '.join(missing_fields):12s}] {m['name']!r:40s} users={m['user_count']} graph_dept={gdn!r}")
    print()

    # ----------------------------------------------------------------
    # D. Managers/Directors with no CC role
    # ----------------------------------------------------------------
    print(f"{'='*60}")
    print(f"D. ACTIVE MANAGERS NOT ASSIGNED AS RO/DIRECTOR ON ANY CC")
    print(f"{'='*60}")
    c.execute("""
        SELECT u.id, u.display_name, u.email, u.role, u.cost_center_id,
               cc.name as own_cc_name
        FROM users u
        LEFT JOIN cost_centers cc ON cc.id = u.cost_center_id
        WHERE u.tenant_id = ?
          AND u.is_active = 1
          AND u.role = 'Manager'
          AND u.id NOT IN (
              SELECT ro_user_id FROM cost_centers WHERE tenant_id = ? AND ro_user_id IS NOT NULL
              UNION
              SELECT director_user_id FROM cost_centers WHERE tenant_id = ? AND director_user_id IS NOT NULL
          )
        ORDER BY u.display_name
    """, (tenant_id, tenant_id, tenant_id))
    unassigned = c.fetchall()
    print(f"  Count: {len(unassigned)}")
    for u in unassigned:
        print(f"  {u['display_name']!r:40s} email={u['email']!r} own_cc={u['own_cc_name']!r}")
    print()

    # ----------------------------------------------------------------
    # E. CCs with graph_department_name IS NULL
    # ----------------------------------------------------------------
    print(f"{'='*60}")
    print(f"E. ACTIVE CCs WITH graph_department_name IS NULL (sync-invisible)")
    print(f"{'='*60}")
    c.execute("""
        SELECT cc.id, cc.name, cc.sync_protected, cc.is_active,
               cc.ro_user_id, cc.director_user_id,
               (SELECT COUNT(*) FROM users u2 WHERE u2.cost_center_id = cc.id AND u2.is_active = 1) as user_count
        FROM cost_centers cc
        WHERE cc.tenant_id = ? AND cc.graph_department_name IS NULL AND cc.is_active = 1
        ORDER BY cc.name
    """, (tenant_id,))
    null_dept = c.fetchall()
    print(f"  Count: {len(null_dept)}")
    for cc in null_dept:
        print(f"  {cc['name']!r:40s} protected={cc['sync_protected']} users={cc['user_count']}"
              f" ro={'set' if cc['ro_user_id'] else 'NULL'}"
              f" dir={'set' if cc['director_user_id'] else 'NULL'}")
    if null_dept:
        print()
        print("  → These CCs have no graph_department_name set.")
        print("  → Graph sync CANNOT assign users to these CCs by department.")
        print("  → Run: import_departments_from_graph (updated) to backfill graph_department_name,")
        print("    OR manually set graph_department_name via admin UI PATCH /cost-centers/{id}")
    print()

    # ----------------------------------------------------------------
    # F. Near-duplicate department names
    # ----------------------------------------------------------------
    print(f"{'='*60}")
    print(f"F. COST CENTER NAMES WITH SIMILAR SPELLINGS (near-duplicate check)")
    print(f"{'='*60}")
    c.execute("""
        SELECT name, graph_department_name FROM cost_centers
        WHERE tenant_id = ? AND is_active = 1
        ORDER BY name
    """, (tenant_id,))
    all_cc_names = [(r['name'], r['graph_department_name']) for r in c.fetchall()]

    # Build normalized → original mapping
    norm_to_ccs: dict = {}
    for name, gdn in all_cc_names:
        n = normalize_name(name)
        norm_to_ccs.setdefault(n, []).append(f"CC.name={name!r}")
        if gdn:
            ng = normalize_name(gdn)
            if ng != n:
                norm_to_ccs.setdefault(ng, []).append(f"CC.graph_department_name={gdn!r}")

    found_duplicates = False
    for norm, sources in norm_to_ccs.items():
        if len(sources) > 1:
            print(f"  Normalized: {norm!r}")
            for s in sources:
                print(f"    → {s}")
            found_duplicates = True
    if not found_duplicates:
        print("  No near-duplicates detected among active CCs.")
    print()

    # ----------------------------------------------------------------
    # G. Manager chain coverage per CC
    # ----------------------------------------------------------------
    print(f"{'='*60}")
    print(f"G. MANAGER CHAIN COVERAGE — CCs where users have NO manager_object_id")
    print(f"{'='*60}")
    c.execute("""
        SELECT cc.name,
               COUNT(u.id) as total_users,
               SUM(CASE WHEN u.manager_object_id IS NULL THEN 1 ELSE 0 END) as users_without_manager
        FROM cost_centers cc
        JOIN users u ON u.cost_center_id = cc.id AND u.is_active = 1
        WHERE cc.tenant_id = ? AND cc.is_active = 1
        GROUP BY cc.id, cc.name
        HAVING users_without_manager > 0
        ORDER BY cc.name
    """, (tenant_id,))
    chain_gaps = c.fetchall()
    if chain_gaps:
        for row in chain_gaps:
            print(f"  {row['name']!r:40s} total={row['total_users']} no_manager={row['users_without_manager']}")
        print()
        print("  → Users without manager_object_id cannot contribute to RO/Director detection.")
        print("  → Ensure run_graph_sync has run to refresh manager links.")
    else:
        print("  All CC users have manager_object_id set.")
    print()

    # ----------------------------------------------------------------
    # H. Summary
    # ----------------------------------------------------------------
    print(f"{'='*60}")
    print(f"H. SUMMARY COUNTS")
    print(f"{'='*60}")
    c.execute("SELECT COUNT(*) FROM cost_centers WHERE tenant_id = ? AND is_active = 1", (tenant_id,))
    total_ccs = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM cost_centers WHERE tenant_id = ? AND is_active = 1 AND ro_user_id IS NOT NULL", (tenant_id,))
    with_ro = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM cost_centers WHERE tenant_id = ? AND is_active = 1 AND director_user_id IS NOT NULL", (tenant_id,))
    with_dir = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM cost_centers WHERE tenant_id = ? AND is_active = 1 AND graph_department_name IS NOT NULL", (tenant_id,))
    with_gdn = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM cost_centers WHERE tenant_id = ? AND sync_protected = 1", (tenant_id,))
    protected = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM users WHERE tenant_id = ? AND is_active = 1", (tenant_id,))
    active_users = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM users WHERE tenant_id = ? AND is_active = 1 AND role = 'Manager'", (tenant_id,))
    manager_count = c.fetchone()[0]

    print(f"  Active CCs:                     {total_ccs}")
    print(f"  Active CCs with RO set:         {with_ro}")
    print(f"  Active CCs with Director set:   {with_dir}")
    print(f"  Active CCs with both NULL:      {total_ccs - max(with_ro, with_dir)}")
    print(f"  Active CCs with graph_dept_name:{with_gdn}")
    print(f"  Active CCs with NULL graph_dept:{total_ccs - with_gdn}")
    print(f"  Sync-protected CCs:             {protected}")
    print(f"  Active users:                   {active_users}")
    print(f"  Active Managers:                {manager_count}")
    print()

    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Diagnose CC manager assignment state (read-only)")
    parser.add_argument("--db", default="api/dev.db", help="Path to SQLite database (default: api/dev.db)")
    parser.add_argument("--tenant", default=None, help="Tenant ID (auto-detected if only one tenant)")
    parser.add_argument("--user", default=None, help="Target user email (default: kahi@ferrosanmd.com)")
    args = parser.parse_args()

    if not os.path.exists(args.db):
        print(f"ERROR: database not found at '{args.db}'")
        sys.exit(1)

    run_diagnostic(args.db, args.tenant, args.user)


if __name__ == "__main__":
    main()
