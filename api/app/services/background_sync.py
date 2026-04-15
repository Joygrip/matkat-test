"""Background sync: refresh Graph-backed user data for all users in a tenant.

Designed to run on a schedule (nightly) or on demand via the admin endpoint.
Uses the client credentials (app-only) flow — no user token required.

Fields refreshed from Graph (Graph-owned):
    User.email            — from mail / userPrincipalName
    User.display_name     — from displayName
    User.manager_object_id— from /users/{oid}/manager
    User.is_active        — set to False when accountEnabled=false in Entra;
                            never auto-set back to True (admin must re-activate)

Fields NOT touched (app-owned):
    User.role
    User.cost_center_id
    Resource.*            — all Resource fields; resources with user_id=None are skipped

Idempotent: running sync repeatedly with unchanged Graph data produces no DB writes
(same values assigned) and all counters remain at 0 except total_users / synced.
"""
import logging
from dataclasses import dataclass, asdict
from datetime import datetime

from sqlalchemy.orm import Session

from api.app.config import Settings
from api.app.models.core import User, CostCenter, UserRole, generate_uuid
from api.app.services.graph_app_client import GraphAppClient, FETCH_FAILED

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    tenant_id: str
    total_users: int       # all User rows queried
    synced: int            # processed from Graph without error
    missing_from_graph: int  # 404 from Graph
    deactivated: int       # set is_active=False (disabled in Entra or missing, if configured)
    manager_changes: int   # manager_object_id value changed
    errors: int            # unexpected exceptions per user
    started_at: datetime
    finished_at: datetime

    def as_dict(self) -> dict:
        d = asdict(self)
        d["started_at"] = self.started_at.isoformat()
        d["finished_at"] = self.finished_at.isoformat()
        return d


def run_graph_sync(db: Session, settings: Settings, tenant_id: str) -> SyncResult:
    """Sync all User rows for *tenant_id* against Microsoft Graph.

    Queries every user in the tenant (including inactive ones — they may have been
    manually deactivated in the app and we still want to keep profile data current).

    Safe to call repeatedly — produces no side effects when Graph data matches DB.
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

    # Early exit if Graph is not configured
    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        logger.warning(
            "background_sync: Graph credentials not configured — sync skipped for tenant %s",
            tenant_id,
        )
        result.finished_at = datetime.utcnow()
        return result

    users: list[User] = (
        db.query(User).filter(User.tenant_id == tenant_id).all()
    )
    result.total_users = len(users)
    logger.info(
        "background_sync: starting for tenant=%s, user_count=%d", tenant_id, len(users)
    )

    for user in users:
        try:
            _sync_user(db, graph, settings, user, result)
        except Exception as exc:
            logger.error(
                "background_sync: unexpected error processing user object_id=%s: %s",
                user.object_id,
                exc,
            )
            result.errors += 1

    db.commit()

    result.finished_at = datetime.utcnow()
    duration_ms = int((result.finished_at - result.started_at).total_seconds() * 1000)
    logger.info(
        "background_sync: finished for tenant=%s — "
        "total=%d synced=%d missing=%d deactivated=%d manager_changes=%d errors=%d duration_ms=%d",
        tenant_id,
        result.total_users,
        result.synced,
        result.missing_from_graph,
        result.deactivated,
        result.manager_changes,
        result.errors,
        duration_ms,
    )
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sync_user(
    db: Session,
    graph: GraphAppClient,
    settings: Settings,
    user: User,
    result: SyncResult,
) -> None:
    """Process a single user: refresh profile and manager from Graph."""
    oid = user.object_id

    # --- Profile ---
    graph_user = graph.get_user(oid)

    if graph_user is FETCH_FAILED:
        # Network / auth error — skip this user entirely, count as error
        logger.error(
            "background_sync: Graph call failed for object_id=%s — skipping", oid
        )
        result.errors += 1
        return

    if graph_user is None:
        # 404 — user not found in Graph
        logger.warning(
            "background_sync: user object_id=%s not found in Graph (missing_from_graph)",
            oid,
        )
        result.missing_from_graph += 1
        if settings.graph_sync_deactivate_missing and user.is_active:
            user.is_active = False
            result.deactivated += 1
            logger.info(
                "background_sync: marking user object_id=%s inactive "
                "(GRAPH_SYNC_DEACTIVATE_MISSING=true)",
                oid,
            )
        return

    # User found — refresh profile fields
    graph_email = graph_user.get("mail") or graph_user.get("userPrincipalName") or ""
    graph_name = graph_user.get("displayName") or ""
    graph_department = graph_user.get("department") or ""

    if graph_email:
        user.email = graph_email
    if graph_name:
        user.display_name = graph_name

    # Resolve Graph department → CostCenter.graph_department_name → User.cost_center_id
    if graph_department:
        cc = db.query(CostCenter).filter(
            CostCenter.tenant_id == user.tenant_id,
            CostCenter.graph_department_name == graph_department,
            CostCenter.is_active == True,
        ).first()
        if cc and user.cost_center_id != cc.id:
            user.cost_center_id = cc.id

    # Deactivate if Entra says accountEnabled=false
    if graph_user.get("accountEnabled") is False and user.is_active:
        user.is_active = False
        result.deactivated += 1
        logger.info(
            "background_sync: user object_id=%s is disabled in Entra — marking inactive", oid
        )

    # --- Manager ---
    new_manager_oid = graph.get_user_manager_id(oid)

    if new_manager_oid is FETCH_FAILED:
        # Manager call failed — don't touch manager_object_id; already counted in errors above
        # but we still count the user as partially synced (profile was OK)
        result.errors += 1
    else:
        # new_manager_oid is either a str (manager found) or None (confirmed no manager)
        if new_manager_oid != user.manager_object_id:
            logger.info(
                "background_sync: manager changed for object_id=%s old=%s new=%s",
                oid,
                user.manager_object_id,
                new_manager_oid,
            )
            user.manager_object_id = new_manager_oid
            result.manager_changes += 1

        result.synced += 1

def import_users_from_graph(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Import all enabled Entra users into the DB as Employee role.

    Existing users (matched by object_id) are skipped — only new users are created.
    Role and cost_center_id are NOT set automatically (admin assigns after import).
    Cost center is auto-assigned if CostCenter.graph_department_name matches.

    Returns a summary dict with created/skipped/errors counts.
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
            graph_department = gu.get("department") or ""

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

            # Auto-assign cost center if department matches
            if graph_department:
                cc = db.query(CostCenter).filter(
                    CostCenter.tenant_id == tenant_id,
                    CostCenter.graph_department_name == graph_department,
                    CostCenter.is_active == True,
                ).first()
                if cc:
                    new_user.cost_center_id = cc.id

            created += 1
            logger.info("import_users: created user object_id=%s email=%s", oid, email)

        except Exception as exc:
            logger.error("import_users: error processing user object_id=%s: %s", oid, exc)
            errors += 1

    db.commit()
    logger.info(
        "import_users: done — created=%d skipped=%d errors=%d",
        created, skipped, errors,
    )
    return {
        "total_from_graph": len(graph_users),
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }


def import_departments_from_graph(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Import unique Graph department values as CostCenters.

    Creates a new CostCenter for each department name not already present.
    The 'code' field is left blank for the admin to fill in manually.
    """
    graph = GraphAppClient(settings)

    if not (settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id):
        return {"error": "Graph credentials not configured"}

    graph_users = graph.list_all_users()
    if not graph_users:
        return {"error": "No users returned from Graph or Graph call failed"}

    unique_departments = {
        u.get("department")
        for u in graph_users
        if u.get("department")
    }

    created = 0
    skipped = 0
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

            new_cc = CostCenter(
                id=generate_uuid(),
                tenant_id=tenant_id,
                name=department,
                graph_department_name=department,
                code=department[:5].upper(),
                is_active=True,
            )
            db.add(new_cc)
            db.flush()
            created += 1
            logger.info("import_departments: created cost_center name=%s", department)
        except Exception as exc:
            logger.error(
                "import_departments: error processing department=%s: %s", department, exc
            )
            errors += 1

    db.commit()
    logger.info(
        "import_departments: done — created=%d skipped=%d errors=%d",
        created, skipped, errors,
    )
    return {
        "total_departments": len(unique_departments),
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }


def assign_users_to_departments(db: Session, settings: Settings, tenant_id: str) -> dict:
    """Re-run Graph sync to assign users to cost centers via department name matching."""
    result = run_graph_sync(db, settings, tenant_id)
    return result.as_dict()


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
                logger.info(
                    "promote_managers: promoted object_id=%s email=%s",
                    user.object_id,
                    user.email,
                )
            else:
                skipped += 1

    db.commit()
    logger.info(
        "promote_managers: done — promoted=%d skipped=%d errors=%d",
        promoted, skipped, errors,
    )
    return {
        "total_users_checked": len(db_users),
        "total_managers_in_graph": len(managers_set),
        "promoted": promoted,
        "skipped": skipped,
        "errors": errors,
    }