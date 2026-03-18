"""Login-time sync of user profile and manager from Microsoft Graph.

Called on every authenticated request (production path only).
Best-effort: Graph failures are logged and swallowed — login always succeeds.
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from api.app.config import Settings
from api.app.models.core import User, UserRole
from api.app.services.graph import GraphClient, _MANAGER_FETCH_FAILED

logger = logging.getLogger(__name__)


async def sync_user_from_graph(
    db: Session,
    settings: Settings,
    user_access_token: str,
    tenant_id: str,
    object_id: str,
    email: str,
    display_name: str,
) -> User:
    """Upsert a User record using JWT claims, then enrich from Graph.

    Steps:
    1. Create or update the User row from JWT claims (always available).
    2. If Graph credentials are configured, call /me and /me/manager to enrich
       the user's email, display_name, and manager_object_id.
    3. Commit and return the User.

    Never raises — caller (get_current_user) must always get a User back.
    """
    # ------------------------------------------------------------------
    # Step 1: upsert from JWT claims
    # ------------------------------------------------------------------
    db_user: Optional[User] = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.object_id == object_id)
        .first()
    )

    if db_user is None:
        db_user = User(
            tenant_id=tenant_id,
            object_id=object_id,
            email=email,
            display_name=display_name,
            role=UserRole.EMPLOYEE,
            is_active=True,
        )
        db.add(db_user)
        db.flush()
        logger.info("Auto-provisioned new user object_id=%s email=%s", object_id, email)
    else:
        # Refresh basic fields from the JWT on every login
        if email:
            db_user.email = email
        if display_name:
            db_user.display_name = display_name

    # ------------------------------------------------------------------
    # Step 2: best-effort Graph enrichment (skipped when not configured)
    # ------------------------------------------------------------------
    graph_configured = bool(
        settings.graph_client_id and settings.graph_client_secret and settings.azure_tenant_id
    )

    if graph_configured:
        graph = GraphClient(user_access_token, settings)

        # /me — richer profile data
        try:
            me = await graph.get_me()
            if me:
                graph_email = me.get("mail") or me.get("userPrincipalName") or ""
                graph_name = me.get("displayName") or ""
                if graph_email:
                    db_user.email = graph_email
                if graph_name:
                    db_user.display_name = graph_name
        except Exception as exc:
            logger.warning("Graph /me enrichment failed for %s: %s", object_id, exc)

        # /me/manager — manager relationship for approval routing
        try:
            manager_oid = await graph.get_manager_object_id()
            if manager_oid is not _MANAGER_FETCH_FAILED:
                # None means confirmed no manager (404); str means manager found
                db_user.manager_object_id = manager_oid
        except Exception as exc:
            logger.warning("Graph /me/manager failed for %s: %s", object_id, exc)

    # ------------------------------------------------------------------
    # Step 3: persist
    # ------------------------------------------------------------------
    db.commit()
    db.refresh(db_user)
    return db_user
