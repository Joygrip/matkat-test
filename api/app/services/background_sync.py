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
from api.app.models.core import User, CostCenter
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
            CostCenter.is_active.is_(True),
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
