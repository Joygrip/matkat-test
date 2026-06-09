"""Background sync: refresh Graph-backed user/CC data for all users in a tenant.

Designed to run on a schedule (nightly) or on demand via the admin endpoint.
Uses the client credentials (app-only) flow — no user token required.

Testing checklist:
- [ ] User with new department → new CC created, user assigned
- [ ] User department renamed → new CC created, user moved, old CC marked inactive if empty
- [ ] User with NULL department → cost_center_id set to NULL
- [ ] sync_protected CC → users not reassigned
- [ ] RO/Director only set if currently NULL
- [ ] Manual RO/Director survives sync
- [ ] Empty non-protected CCs marked inactive
- [ ] Sync is idempotent (running twice produces same result)

Full sync steps (run_full_sync):
  1. import_users_from_graph    — create new Entra users in DB
  2. run_graph_sync             — refresh email / display_name / manager_object_id / is_active
  3. _sync_cc_assignments       — assign every user to the CC matching their Graph department
  4. _mark_empty_ccs_inactive   — soft-delete CCs with zero users (non-protected only)
  5. promote_managers_from_graph— promote EMPLOYEE→MANAGER for anyone who manages others
  6. create_resources_from_users— create/update Resource rows for active users
  7. assign_cost_center_managers— set RO/Director on CCs (NULL-only; never overwrites manual values)

Design invariants (non-negotiable):
  - Graph is the sole source of truth for users and their CC assignments.
  - Department rename → new CC; old CC soft-deleted when empty; never rename existing CCs.
  - sync_protected CCs: users are never moved into or out of them by sync.
  - RO/Director: only written when the current DB value is NULL.
  - All logging via print() — logger.info is invisible on Azure App Service.
"""
import logging
import re
from dataclasses import dataclass, asdict
from datetime import datetime

from sqlalchemy.orm import Session

from api.app.config import Settings
from api.app.models.core import User, CostCenter, UserRole, Resource, ResourceType, generate_uuid
from api.app.services.graph_app_client import GraphAppClient, FETCH_FAILED

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class SyncResult:
    tenant_id: str
    total_users: int
    synced: int
    missing_from_graph: int
    deactivated: int
    manager_changes: int
    errors: int
    started_at: datetime
    finished_at: datetime

    def as_dict(self) -> dict:
        d = asdict(self)
        d["started_at"] = self.started_at.isoformat()
        d["finished_at"] = self.finished_at.isoformat()
        return d


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def normalize_department_name(name: str) -> str:
    """Normalize a department name for fuzzy matching: lowercase, collapse whitespace, expand '&'."""
    if not name:
        return ""
    s = name.strip().lower()
    s = re.sub(r'\s+', ' ', s)
    s = s.replace(' and ', ' & ')
    return s


def _generate_cc_code(db: Session, tenant_id: str, department_name: str) -> str:
    """Generate a unique 5-char code for a new CC derived from department_name."""
    base = "".join(department_name.split())[:5].upper() or "CC"
    code = base
    counter = 2
    while db.query(CostCenter).filter(
        CostCenter.tenant_id == tenant_id,
        CostCenter.code == code,
    ).first():
        code = f"{base[:4]}{counter}"
        counter += 1
    return code


def _find_ro_candidate(cc: CostCenter, cc_users: list, users_by_object_id: dict):
    """Walk the manager chain from each CC member.

    Returns the first same-CC manager found by walking chains from non-manager users
    (preferred), or the first manager found anywhere in the chain (fallback), or None.

    Walking only from non-managers in the first pass prevents a director (who IS a manager)
    from being selected as RO when both the RO and Director sit in the same CC.
    """
    _manager_roles = {UserRole.MANAGER, UserRole.ADMIN, UserRole.FINANCE, UserRole.PM}

    # First pass: walk chains from non-manager users to find same-CC manager (= RO)
    non_mgr_users = [u for u in cc_users if u.role not in _manager_roles]
    first_pass_users = non_mgr_users if non_mgr_users else cc_users

    for user in first_pass_users:
        visited = {user.object_id}
        oid = user.manager_object_id
        while oid and oid not in visited:
            visited.add(oid)
            mgr = users_by_object_id.get(oid)
            if not mgr:
                break
            if mgr.cost_center_id == cc.id:
                return mgr
            oid = mgr.manager_object_id

    # Second pass: any manager reachable in the full chain (fallback for cross-CC directors)
    for user in cc_users:
        visited = {user.object_id}
        oid = user.manager_object_id
        while oid and oid not in visited:
            visited.add(oid)
            mgr = users_by_object_id.get(oid)
            if mgr:
                return mgr
            break

    return None


def _get_initials(user: User) -> str:
    """Extract initials from email prefix (ferrosanmd.com) or first letters of display_name."""
    if user.email and "@ferrosanmd.com" in user.email.lower():
        return user.email.split("@")[0].upper()[:20]
    return "".join(word[0].upper() for word in (user.display_name or "").split() if word)[:3]


# ---------------------------------------------------------------------------
# Step 1: Import new users from Graph
# ---------------------------------------------------------------------------

def import_users_from_graph(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Import all enabled Entra users into the DB as Employee role.

    Existing users (matched by object_id) are skipped — only new users are created.
    CC assignment is NOT done here; it is handled by _sync_cc_assignments (Step 3).
    """
    graph = GraphAppClient(settings)

    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        return {"error": "Graph credentials not configured"}

    graph_users = graph.list_all_users()
    if not graph_users:
        return {"error": "No users returned from Graph or Graph call failed"}

    created = 0
    skipped = 0
    errors = 0

    for gu in graph_users:
        oid = gu.get("id")
        if not oid:
            errors += 1
            continue
        try:
            existing = db.query(User).filter(
                User.tenant_id == tenant_id,
                User.object_id == oid,
            ).first()

            if existing:
                skipped += 1
                continue

            email = gu.get("mail") or gu.get("userPrincipalName") or ""
            display_name = gu.get("displayName") or email

            new_user = User(
                tenant_id=tenant_id,
                object_id=oid,
                email=email,
                display_name=display_name,
                role=UserRole.EMPLOYEE,
                is_active=True,
            )
            db.add(new_user)
            db.flush()
            created += 1
            print(f"import_users: created user object_id={oid} email={email}")

        except Exception as exc:
            print(f"import_users: error processing user object_id={oid}: {exc}")
            errors += 1

    db.commit()
    print(f"import_users: done — created={created} skipped={skipped} errors={errors}")
    return {
        "total_from_graph": len(graph_users),
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Step 2: Sync profile fields and manager chain
# ---------------------------------------------------------------------------

def run_graph_sync(db: Session, settings: Settings, tenant_id: str) -> SyncResult:
    """Refresh email, display_name, manager_object_id, and is_active for all DB users.

    Does NOT touch cost_center_id — CC assignment is handled by _sync_cc_assignments.
    Safe to call repeatedly (idempotent when Graph data is unchanged).
    """
    started_at = datetime.utcnow()
    result = SyncResult(
        tenant_id=tenant_id,
        total_users=0,
        synced=0,
        missing_from_graph=0,
        deactivated=0,
        manager_changes=0,
        errors=0,
        started_at=started_at,
        finished_at=started_at,
    )

    graph = GraphAppClient(settings)

    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        print(f"background_sync: Graph credentials not configured — skipping for tenant {tenant_id}")
        result.finished_at = datetime.utcnow()
        return result

    users: list[User] = db.query(User).filter(User.tenant_id == tenant_id).all()
    result.total_users = len(users)
    print(f"background_sync: starting for tenant={tenant_id}, user_count={len(users)}")

    all_graph_users = graph.list_all_users()
    if not all_graph_users:
        print("background_sync: list_all_users returned empty — skipping sync")
        result.finished_at = datetime.utcnow()
        return result

    graph_users_by_oid = {gu.get("id"): gu for gu in all_graph_users if gu.get("id")}
    print(f"background_sync: fetched {len(graph_users_by_oid)} users from Graph in batch")

    all_oids: list[str] = list(graph_users_by_oid.keys())
    manager_map = graph.batch_get_managers(all_oids)
    print(f"background_sync: fetched {len(manager_map)} manager mappings in batch")

    for user in users:
        try:
            prefetched = graph_users_by_oid.get(user.object_id)
            manager_oid = manager_map.get(user.object_id, FETCH_FAILED)
            _sync_user(db, graph, settings, user, result,
                       prefetched_graph_user=prefetched,
                       prefetched_manager_oid=manager_oid)
        except Exception as exc:
            print(f"background_sync: unexpected error processing user object_id={user.object_id}: {exc}")
            result.errors += 1

    db.commit()

    result.finished_at = datetime.utcnow()
    duration_ms = int((result.finished_at - result.started_at).total_seconds() * 1000)
    print(
        f"background_sync: finished tenant={tenant_id} — "
        f"total={result.total_users} synced={result.synced} missing={result.missing_from_graph} "
        f"deactivated={result.deactivated} manager_changes={result.manager_changes} "
        f"errors={result.errors} duration_ms={duration_ms}"
    )
    return result


def _sync_user(
    db: Session,
    graph: GraphAppClient,
    settings: Settings,
    user: User,
    result: SyncResult,
    prefetched_graph_user=None,
    prefetched_manager_oid=FETCH_FAILED,
) -> None:
    """Refresh profile fields and manager for a single user. Does NOT touch cost_center_id."""
    oid = user.object_id

    graph_user = prefetched_graph_user if prefetched_graph_user is not None else graph.get_user(oid)

    if graph_user is FETCH_FAILED:
        print(f"background_sync: Graph call failed for object_id={oid} — skipping")
        result.errors += 1
        return

    if graph_user is None:
        print(f"background_sync: user object_id={oid} not found in Graph (missing_from_graph)")
        result.missing_from_graph += 1
        if settings.graph_sync_deactivate_missing and user.is_active:
            user.is_active = False
            result.deactivated += 1
            print(f"background_sync: marking user object_id={oid} inactive (GRAPH_SYNC_DEACTIVATE_MISSING=true)")
            linked_resource = db.query(Resource).filter(
                Resource.user_id == user.id,
                Resource.tenant_id == user.tenant_id,
                Resource.is_active == True,
            ).first()
            if linked_resource:
                linked_resource.is_active = False
        return

    graph_email = graph_user.get("mail") or graph_user.get("userPrincipalName") or ""
    graph_name = graph_user.get("displayName") or ""
    graph_country = graph_user.get("country") or None

    if graph_email:
        user.email = graph_email
    if graph_name:
        user.display_name = graph_name
    user.country = graph_country

    if graph_user.get("accountEnabled") is False and user.is_active:
        user.is_active = False
        result.deactivated += 1
        print(f"background_sync: user object_id={oid} disabled in Entra — marking inactive")
        linked_resource = db.query(Resource).filter(
            Resource.user_id == user.id,
            Resource.tenant_id == user.tenant_id,
            Resource.is_active == True,
        ).first()
        if linked_resource:
            linked_resource.is_active = False

    new_manager_oid = (
        prefetched_manager_oid
        if prefetched_manager_oid is not FETCH_FAILED
        else graph.get_user_manager_id(oid)
    )

    if new_manager_oid is FETCH_FAILED:
        result.errors += 1
    else:
        if new_manager_oid != user.manager_object_id:
            print(
                f"background_sync: manager changed for object_id={oid} "
                f"old={user.manager_object_id} new={new_manager_oid}"
            )
            user.manager_object_id = new_manager_oid
            result.manager_changes += 1
        result.synced += 1


# ---------------------------------------------------------------------------
# Step 3: Sync CC assignments from Graph department field
# ---------------------------------------------------------------------------

def _sync_cc_assignments(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Assign every active user to the CC matching their Graph department field.

    Rules:
    - Users on a sync_protected CC are skipped entirely (not moved in or out).
    - NULL department → user.cost_center_id set to NULL.
    - If no CC with graph_department_name==dept exists, a new CC is created.
    - When a user moves CCs, their Resource row's cost_center_id is also updated.
    - This is idempotent: running twice with unchanged Graph data writes nothing.
    """
    graph = GraphAppClient(settings)

    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        return {"error": "Graph credentials not configured"}

    graph_users = graph.list_all_users()
    if not graph_users:
        return {"error": "No users returned from Graph"}

    # Map object_id → Graph department (None = no department)
    dept_by_oid: dict[str, str | None] = {}
    for gu in graph_users:
        oid = gu.get("id")
        if oid:
            dept_by_oid[oid] = gu.get("department") or None

    # Map graph_department_name → CC for active, non-protected CCs
    cc_by_dept: dict[str, CostCenter] = {}
    # Also build a normalized-name lookup for CCs that have graph_department_name=NULL
    # so that manually-created CCs can be matched by fuzzy name comparison.
    cc_by_norm: dict[str, CostCenter] = {}
    for cc in db.query(CostCenter).filter(
        CostCenter.tenant_id == tenant_id,
        CostCenter.is_active == True,
        CostCenter.sync_protected == False,
    ).all():
        if cc.graph_department_name:
            cc_by_dept[cc.graph_department_name] = cc
        else:
            norm = normalize_department_name(cc.name)
            if norm:
                cc_by_norm[norm] = cc

    # Set of CC IDs that are sync_protected (users on these CCs are never moved)
    protected_cc_ids: set[str] = {
        cc.id
        for cc in db.query(CostCenter).filter(
            CostCenter.tenant_id == tenant_id,
            CostCenter.sync_protected == True,
        ).all()
    }

    db_users: list[User] = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.is_active == True,
    ).all()

    assigned = 0
    cleared = 0
    created_ccs = 0
    errors = 0

    for user in db_users:
        # Skip users not present in Graph (will have been handled by run_graph_sync)
        if user.object_id not in dept_by_oid:
            continue

        # Skip users on manually protected CCs
        if user.cost_center_id and user.cost_center_id in protected_cc_ids:
            continue

        dept = dept_by_oid[user.object_id]

        try:
            with db.begin_nested():
                if not dept:
                    # NULL department → clear CC assignment
                    if user.cost_center_id is not None:
                        user.cost_center_id = None
                        cleared += 1
                        print(f"sync_cc: cleared CC for user={user.object_id} (no Graph department)")
                    continue

                # Find or create CC for this department
                cc = cc_by_dept.get(dept)
                if cc is None:
                    # Try normalized-name fallback for manually-created CCs (graph_department_name=NULL)
                    norm_dept = normalize_department_name(dept)
                    cc = cc_by_norm.get(norm_dept)
                    if cc is not None:
                        # Backfill graph_department_name so exact matching works next time
                        cc.graph_department_name = dept
                        cc_by_dept[dept] = cc
                        cc_by_norm.pop(norm_dept, None)
                        print(f"sync_cc: backfilled graph_department_name='{dept}' on CC='{cc.name}'")
                if cc is None:
                    # Double-check DB in case another user already created it this session
                    cc = db.query(CostCenter).filter(
                        CostCenter.tenant_id == tenant_id,
                        CostCenter.graph_department_name == dept,
                        CostCenter.is_active == True,
                    ).first()
                    if cc is None:
                        code = _generate_cc_code(db, tenant_id, dept)
                        cc = CostCenter(
                            id=generate_uuid(),
                            tenant_id=tenant_id,
                            name=dept,
                            graph_department_name=dept,
                            code=code,
                            is_active=True,
                            sync_protected=False,
                        )
                        db.add(cc)
                        db.flush()
                        created_ccs += 1
                        print(f"sync_cc: created new CC name='{dept}' code={code}")
                    cc_by_dept[dept] = cc

                # Assign user if different
                if user.cost_center_id != cc.id:
                    user.cost_center_id = cc.id
                    # Mirror the move on the linked Resource row
                    resource = db.query(Resource).filter(
                        Resource.user_id == user.id,
                        Resource.tenant_id == tenant_id,
                    ).first()
                    if resource:
                        resource.cost_center_id = cc.id
                    assigned += 1
                    print(f"sync_cc: assigned user={user.object_id} → CC='{cc.name}'")

        except Exception as exc:
            print(f"sync_cc: error processing user={user.object_id}: {exc}")
            errors += 1

    db.commit()
    print(f"sync_cc: done — assigned={assigned} cleared={cleared} created_ccs={created_ccs} errors={errors}")
    return {
        "assigned": assigned,
        "cleared": cleared,
        "created_ccs": created_ccs,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Step 4: Mark empty CCs inactive
# ---------------------------------------------------------------------------

def _mark_empty_ccs_inactive(db: Session, tenant_id: str) -> dict:
    """Soft-delete active, non-protected CCs that have zero active users assigned.

    Never hard-deletes. Never touches sync_protected CCs.
    Idempotent: already-inactive CCs are ignored.
    """
    active_unprotected = db.query(CostCenter).filter(
        CostCenter.tenant_id == tenant_id,
        CostCenter.is_active == True,
        CostCenter.sync_protected == False,
    ).all()

    deactivated = 0
    for cc in active_unprotected:
        user_count = db.query(User).filter(
            User.cost_center_id == cc.id,
            User.is_active == True,
        ).count()
        if user_count == 0:
            cc.is_active = False
            deactivated += 1
            print(f"mark_empty: deactivated CC id={cc.id} name='{cc.name}'")

    db.commit()
    print(f"mark_empty: done — deactivated={deactivated}")
    return {"checked": len(active_unprotected), "deactivated": deactivated}


# ---------------------------------------------------------------------------
# Step 5: Promote managers from Graph
# ---------------------------------------------------------------------------

def promote_managers_from_graph(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Promote users to Manager role if they manage at least one other user in Graph.

    Never demotes — users with ADMIN, FINANCE, PM, or MANAGER roles are left unchanged.
    """
    graph = GraphAppClient(settings)

    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        return {"error": "Graph credentials not configured"}

    db_users: list[User] = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.is_active == True)
        .all()
    )

    object_ids = [u.object_id for u in db_users if u.object_id]
    managers_set = graph.list_all_managers(object_ids)

    if not managers_set:
        return {"error": "No managers found or Graph call failed"}

    promoted = 0
    skipped = 0
    errors = 0

    for user in db_users:
        if user.object_id in managers_set:
            if user.role == UserRole.EMPLOYEE:
                user.role = UserRole.MANAGER
                promoted += 1
                print(f"promote_managers: promoted object_id={user.object_id} email={user.email}")
            else:
                skipped += 1

    db.commit()
    print(f"promote_managers: done — promoted={promoted} skipped={skipped} errors={errors}")
    return {
        "total_users_checked": len(db_users),
        "total_managers_in_graph": len(managers_set),
        "promoted": promoted,
        "skipped": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Step 6: Create / update Resource rows
# ---------------------------------------------------------------------------

def create_resources_from_users(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Create Resource entries for active Employee and Manager users that don't have one.

    Also corrects initials and cost_center_id drift on existing Resources.
    Only processes users who have a cost_center_id assigned.
    """
    users: list[User] = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.role.in_([UserRole.EMPLOYEE, UserRole.MANAGER]),
            User.is_active == True,
            User.cost_center_id != None,
        )
        .all()
    )

    created = 0
    skipped = 0
    errors = 0

    for user in users:
        try:
            existing = db.query(Resource).filter(
                Resource.user_id == user.id,
                Resource.tenant_id == tenant_id,
            ).first()

            if existing:
                dirty = False
                correct_initials = _get_initials(user)
                if existing.initials != correct_initials:
                    existing.initials = correct_initials
                    dirty = True
                # Repair cost_center_id drift (can happen if _sync_cc_assignments missed the resource)
                if existing.cost_center_id != user.cost_center_id and user.cost_center_id:
                    existing.cost_center_id = user.cost_center_id
                    dirty = True
                if dirty:
                    db.flush()
                skipped += 1
                continue

            initials = _get_initials(user)
            new_resource = Resource(
                id=generate_uuid(),
                tenant_id=tenant_id,
                user_id=user.id,
                cost_center_id=user.cost_center_id,
                employee_id=user.object_id[:50],
                display_name=user.display_name,
                initials=initials,
                email=user.email,
                resource_type=ResourceType.EMPLOYEE,
                is_active=True,
                hourly_cost=None,
            )
            db.add(new_resource)
            created += 1
            print(f"create_resources: created resource user_id={user.id} display_name={user.display_name}")

        except Exception as exc:
            print(f"create_resources: error processing user_id={user.id}: {exc}")
            errors += 1

    db.commit()
    print(f"create_resources: done — created={created} skipped={skipped} errors={errors}")
    return {
        "total_eligible_users": len(users),
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Step 7: Assign RO / Director from hierarchy
# ---------------------------------------------------------------------------

def assign_cost_center_managers(db: Session, settings: Settings, tenant_id: str, force: bool = False) -> dict:
    """Assign RO (1st level) and Director (2nd level) to each active, non-protected CC.

    Hierarchy walk: for each CC, walk the manager chain from its members.
    The first manager found who is ALSO in the same CC = candidate RO.
    If no same-CC manager found, the first manager in the chain (any CC) = candidate RO.
    RO's manager_object_id resolves to Director.

    When force=False (default): only sets ro_user_id / director_user_id when NULL.
    When force=True: re-evaluates all non-protected CCs, overwriting stale assignments.
    sync_protected CCs are always skipped regardless of force.
    """
    graph = GraphAppClient(settings)
    graph_configured = bool(
        settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id
    )

    cost_centers: list[CostCenter] = (
        db.query(CostCenter)
        .filter(
            CostCenter.tenant_id == tenant_id,
            CostCenter.is_active == True,
            CostCenter.sync_protected == False,
        )
        .all()
    )

    users_by_object_id: dict[str, User] = {
        u.object_id: u
        for u in db.query(User).filter(
            User.tenant_id == tenant_id,
            User.is_active == True,
        ).all()
    }

    # Batch-fetch Graph user data for location (country) — used when setting RO
    graph_users_by_oid: dict[str, dict] = {}
    if graph_configured:
        graph_users = graph.list_all_users()
        if graph_users:
            graph_users_by_oid = {gu.get("id"): gu for gu in graph_users if gu.get("id")}

    updated = 0
    skipped = 0
    errors = 0

    for cc in cost_centers:
        try:
            cc_updated = False

            cc_users: list[User] = db.query(User).filter(
                User.cost_center_id == cc.id,
                User.is_active == True,
            ).all()

            if not cc_users:
                skipped += 1
                continue

            # RO — set if NULL, or overwrite if force=True
            if cc.ro_user_id is None or force:
                ro_candidate = _find_ro_candidate(cc, cc_users, users_by_object_id)
                if ro_candidate and ro_candidate.id != cc.ro_user_id:
                    cc.ro_user_id = ro_candidate.id
                    cc_updated = True
                    print(f"assign_cc_managers: set ro_user_id={ro_candidate.id} ('{ro_candidate.display_name}') for CC='{cc.name}'")

                    # Set location from RO's Graph country, only if currently NULL
                    if cc.location is None and graph_configured:
                        gu = graph_users_by_oid.get(ro_candidate.object_id)
                        if gu:
                            country = gu.get("country") or None
                            if country:
                                cc.location = country
                                print(f"assign_cc_managers: set location={country} for CC='{cc.name}'")

            # Director — set if NULL, or overwrite if force=True (requires RO to be set)
            if (cc.director_user_id is None or force) and cc.ro_user_id:
                ro_user = db.query(User).filter(User.id == cc.ro_user_id).first()
                if ro_user and ro_user.manager_object_id:
                    director_candidate = users_by_object_id.get(ro_user.manager_object_id)
                    if director_candidate and director_candidate.id != cc.director_user_id:
                        cc.director_user_id = director_candidate.id
                        cc_updated = True
                        print(
                            f"assign_cc_managers: set director_user_id={director_candidate.id} "
                            f"('{director_candidate.display_name}') for CC='{cc.name}'"
                        )

            if cc_updated:
                updated += 1
            else:
                skipped += 1

        except Exception as exc:
            print(f"assign_cc_managers: error processing cost_center={cc.id}: {exc}")
            errors += 1

    db.commit()
    print(f"assign_cc_managers: done — updated={updated} skipped={skipped} errors={errors}")
    return {
        "total_cost_centers": len(cost_centers),
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Legacy / standalone helpers (kept for individual endpoint support)
# ---------------------------------------------------------------------------

def import_departments_from_graph(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Import unique Graph department values as CostCenters.

    In the full sync, CC creation happens inline in _sync_cc_assignments.
    This function is kept for the standalone /sync/import-departments endpoint.
    """
    graph = GraphAppClient(settings)

    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        return {"error": "Graph credentials not configured"}

    graph_users = graph.list_all_users()
    if not graph_users:
        return {"error": "No users returned from Graph or Graph call failed"}

    unique_departments: set[str] = {
        dept
        for u in graph_users
        if (dept := u.get("department")) is not None
    }

    # Build normalized-name index for CCs without graph_department_name (manually created)
    cc_by_norm: dict[str, CostCenter] = {}
    for cc in db.query(CostCenter).filter(
        CostCenter.tenant_id == tenant_id,
        CostCenter.graph_department_name == None,  # noqa: E711
    ).all():
        norm = normalize_department_name(cc.name)
        if norm:
            cc_by_norm[norm] = cc

    created = 0
    skipped = 0
    backfilled = 0
    errors = 0

    for department in unique_departments:
        try:
            existing = db.query(CostCenter).filter(
                CostCenter.tenant_id == tenant_id,
                CostCenter.graph_department_name == department,
            ).first()

            if existing:
                skipped += 1
                continue

            # Try normalized match against CCs with graph_department_name=NULL
            norm_dept = normalize_department_name(department)
            existing_by_norm = cc_by_norm.get(norm_dept)
            if existing_by_norm:
                existing_by_norm.graph_department_name = department
                backfilled += 1
                print(f"import_departments: backfilled graph_department_name='{department}' on CC='{existing_by_norm.name}'")
                continue

            code = _generate_cc_code(db, tenant_id, department)
            new_cc = CostCenter(
                id=generate_uuid(),
                tenant_id=tenant_id,
                name=department,
                graph_department_name=department,
                code=code,
                is_active=True,
                sync_protected=False,
            )
            db.add(new_cc)
            db.flush()
            created += 1
            print(f"import_departments: created cost_center name='{department}' code={code}")
        except Exception as exc:
            db.rollback()
            print(f"import_departments: error processing department='{department}': {exc}")
            errors += 1

    db.commit()
    print(f"import_departments: done — created={created} skipped={skipped} backfilled={backfilled} errors={errors}")
    return {
        "total_departments": len(unique_departments),
        "created": created,
        "skipped": skipped,
        "backfilled": backfilled,
        "errors": errors,
    }


def assign_users_to_departments(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Standalone: re-assign all users to their Graph department CC.

    Delegates to _sync_cc_assignments — the canonical implementation.
    """
    return _sync_cc_assignments(db, settings, tenant_id)


# ---------------------------------------------------------------------------
# Full sync orchestrator
# ---------------------------------------------------------------------------

def run_full_sync(db: Session, settings: Settings, tenant_id: str, force_cc_managers: bool = False) -> dict:
    """Run all 7 Graph sync steps in sequence. Each step failure is caught independently.

    force_cc_managers=True re-evaluates RO/Director on all non-protected CCs (not just NULL).
    """
    started_at = datetime.utcnow()
    steps = {}
    total_errors = 0

    print(f"full_sync: starting for tenant={tenant_id}")

    # Step 1: Import new users
    try:
        steps["import_users"] = import_users_from_graph(db, settings, tenant_id)
        total_errors += steps["import_users"].get("errors", 0)
    except Exception as exc:
        print(f"full_sync: step import_users failed: {exc}")
        steps["import_users"] = {"error": str(exc)}
        total_errors += 1

    # Step 2: Refresh profile fields (email, display_name, manager_object_id, is_active)
    original_deactivate = settings.graph_sync_deactivate_missing
    settings.graph_sync_deactivate_missing = True
    try:
        result = run_graph_sync(db, settings, tenant_id)
        steps["sync_profiles"] = result.as_dict()
        total_errors += result.errors
    except Exception as exc:
        print(f"full_sync: step sync_profiles failed: {exc}")
        steps["sync_profiles"] = {"error": str(exc)}
        total_errors += 1
    finally:
        settings.graph_sync_deactivate_missing = original_deactivate

    # Step 3: Sync CC assignments from Graph department field
    try:
        steps["sync_cc_assignments"] = _sync_cc_assignments(db, settings, tenant_id)
        total_errors += steps["sync_cc_assignments"].get("errors", 0)
    except Exception as exc:
        print(f"full_sync: step sync_cc_assignments failed: {exc}")
        steps["sync_cc_assignments"] = {"error": str(exc)}
        total_errors += 1

    # Step 4: Mark empty non-protected CCs inactive
    try:
        steps["mark_empty_ccs"] = _mark_empty_ccs_inactive(db, tenant_id)
    except Exception as exc:
        print(f"full_sync: step mark_empty_ccs failed: {exc}")
        steps["mark_empty_ccs"] = {"error": str(exc)}
        total_errors += 1

    # Step 5: Promote managers
    try:
        steps["promote_managers"] = promote_managers_from_graph(db, settings, tenant_id)
        total_errors += steps["promote_managers"].get("errors", 0)
    except Exception as exc:
        print(f"full_sync: step promote_managers failed: {exc}")
        steps["promote_managers"] = {"error": str(exc)}
        total_errors += 1

    # Step 6: Create / update Resource rows
    try:
        steps["create_resources"] = create_resources_from_users(db, settings, tenant_id)
        total_errors += steps["create_resources"].get("errors", 0)
    except Exception as exc:
        print(f"full_sync: step create_resources failed: {exc}")
        steps["create_resources"] = {"error": str(exc)}
        total_errors += 1

    # Step 7: Assign RO / Director from hierarchy
    try:
        steps["assign_cc_managers"] = assign_cost_center_managers(db, settings, tenant_id, force=force_cc_managers)
        total_errors += steps["assign_cc_managers"].get("errors", 0)
    except Exception as exc:
        print(f"full_sync: step assign_cc_managers failed: {exc}")
        steps["assign_cc_managers"] = {"error": str(exc)}
        total_errors += 1

    finished_at = datetime.utcnow()
    duration = round((finished_at - started_at).total_seconds(), 1)
    print(f"full_sync: completed in {duration}s with {total_errors} total errors")

    return {
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": duration,
        "steps": steps,
        "total_errors": total_errors,
    }
