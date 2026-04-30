"""Microsoft Graph API client using the client credentials (app-only) flow.

Unlike GraphClient (OBO), this client acquires a token on behalf of the application
itself — no user token required. Used exclusively for background sync jobs.

Requires the app registration to have the User.Read.All *application* permission
with admin consent granted in Entra.

All public methods are best-effort: errors are logged and None / sentinel is returned
so callers never have to handle Graph unavailability specially.
"""
import logging
from typing import Optional

import httpx

from api.app.config import Settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_USER_SELECT = "id,displayName,mail,userPrincipalName,accountEnabled,department,country"

# Sentinel returned when a Graph call fails with a network / auth error.
# Callers use `is` identity check to distinguish from a legitimate None value.
FETCH_FAILED = "__GRAPH_APP_ERROR__"


class GraphAppClient:
    """Thin synchronous Graph client backed by the client credentials flow."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._token: Optional[str] = None

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def get_user(self, object_id: str) -> Optional[dict]:
        """Fetch a user's profile from Graph.

        Returns:
            dict  — user profile fields on success
            None  — user not found (404)
            FETCH_FAILED sentinel — any other error
        """
        token = self._get_token()
        if token is FETCH_FAILED:
            return FETCH_FAILED
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{_GRAPH_BASE}/users/{object_id}",
                    params={"$select": _USER_SELECT},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Graph /users/%s call failed: %s", object_id, exc)
            return FETCH_FAILED

    def get_user_manager_id(self, object_id: str) -> Optional[str]:
        """Return the manager's Entra object_id for a given user.

        Returns:
            str           — manager's object_id
            None          — user has no manager (404)
            FETCH_FAILED  — network / auth error
        """
        token = self._get_token()
        if token is FETCH_FAILED:
            return FETCH_FAILED
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{_GRAPH_BASE}/users/{object_id}/manager",
                    params={"$select": "id"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                data = resp.json()
                return data.get("id") or None
        except Exception as exc:
            logger.warning("Graph /users/%s/manager call failed: %s", object_id, exc)
            return FETCH_FAILED

    def list_all_users(self) -> list[dict]:
        """Fetch all @ferrosanmd.com users from Graph with pagination.

        Uses endsWith advanced filter which requires ConsistencyLevel: eventual
        and $count=true. Returns list of user dicts, or empty list on error.
        """
        token = self._get_token()
        if token is FETCH_FAILED:
            logger.warning("GraphAppClient: list_all_users — token acquisition failed")
            return []

        users = []
        url = f"{_GRAPH_BASE}/users"
        params = {
            "$select": _USER_SELECT,
            "$top": 999,
            "$filter": "endsWith(userPrincipalName,'@ferrosanmd.com') and accountEnabled eq true",
            "$count": "true",
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "ConsistencyLevel": "eventual",
        }

        try:
            with httpx.Client(timeout=60) as client:
                batch = 0
                while url:
                    resp = client.get(url, params=params, headers=headers)
                    if resp.status_code != 200:
                        logger.warning(
                            "GraphAppClient: list_all_users got status %d: %.500s",
                            resp.status_code,
                            resp.text,
                        )
                        return []
                    data = resp.json()
                    batch_users = data.get("value", [])
                    users.extend(batch_users)
                    batch += 1
                    logger.info(
                        "GraphAppClient: list_all_users batch %d fetched %d users (running total %d)",
                        batch,
                        len(batch_users),
                        len(users),
                    )
                    url = data.get("@odata.nextLink")
                    params = {}  # nextLink already contains all params
            logger.info("GraphAppClient: list_all_users complete — total %d users", len(users))
            return users
        except Exception as exc:
            logger.warning("GraphAppClient: list_all_users failed: %s", exc)
            return []

    def list_all_managers(self, object_ids: list[str]) -> set[str]:
        """Return the set of object_ids that are managers of at least one user.

        Uses the Graph Batch API (POST $batch) to fetch /users/{oid}/manager for all
        provided object_ids in chunks of 20 (the Graph batch limit).

        Returns an empty set if token acquisition fails or all batch calls fail.
        """
        token = self._get_token()
        if token is FETCH_FAILED:
            logger.warning("list_all_managers: token acquisition failed — returning empty set")
            return set()

        batch_size = 20
        total_batches = (len(object_ids) + batch_size - 1) // batch_size
        logger.info(
            "list_all_managers: processing %d users in %d batches",
            len(object_ids),
            total_batches,
        )

        managers: set[str] = set()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        for batch_index in range(total_batches):
            chunk = object_ids[batch_index * batch_size : (batch_index + 1) * batch_size]
            requests_body = {
                "requests": [
                    {
                        "id": str(i + 1),
                        "method": "GET",
                        "url": f"/users/{oid}/manager?$select=id",
                    }
                    for i, oid in enumerate(chunk)
                ]
            }
            try:
                with httpx.Client(timeout=30) as client:
                    resp = client.post(
                        f"{_GRAPH_BASE}/$batch",
                        json=requests_body,
                        headers=headers,
                    )
                    resp.raise_for_status()
                    batch_responses = resp.json().get("responses", [])
                    for item in batch_responses:
                        status = item.get("status")
                        body = item.get("body") or {}
                        if status == 200:
                            manager_id = body.get("id")
                            if manager_id:
                                managers.add(manager_id)
                        elif status == 404:
                            pass  # user has no manager — expected
                        else:
                            logger.warning(
                                "list_all_managers: unexpected batch item status=%s body=%s",
                                status,
                                body,
                            )
            except Exception as exc:
                logger.warning(
                    "list_all_managers: batch %d/%d call failed: %s",
                    batch_index + 1,
                    total_batches,
                    exc,
                )

        logger.info("list_all_managers: found %d unique managers", len(managers))
        return managers

    # ------------------------------------------------------------------
    # Token acquisition
    # ------------------------------------------------------------------

    def _get_token(self) -> Optional[str]:
        """Acquire (or return cached) an app-only Graph token."""
        if self._token:
            return self._token

        s = self._settings
        if not s.graph_client_id or not s.graph_client_secret or not s.azure_tenant_id:
            logger.warning(
                "GraphAppClient: skipped — GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / "
                "AZURE_TENANT_ID not configured."
            )
            return FETCH_FAILED

        token_url = (
            f"https://login.microsoftonline.com/{s.azure_tenant_id}/oauth2/v2.0/token"
        )
        payload = {
            "grant_type": "client_credentials",
            "client_id": s.graph_client_id,
            "client_secret": s.graph_client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(token_url, data=payload)
                if resp.status_code != 200:
                    logger.warning(
                        "GraphAppClient: token acquisition failed status=%d body=%s",
                        resp.status_code,
                        resp.text,
                    )
                    return FETCH_FAILED
                self._token = resp.json()["access_token"]
                logger.info("GraphAppClient: token acquired successfully")
                return self._token
        except Exception as exc:
            logger.warning("GraphAppClient: token acquisition failed: %s", exc)
            return FETCH_FAILED