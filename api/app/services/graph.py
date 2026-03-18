"""Microsoft Graph API client.

Uses the OAuth 2.0 On-Behalf-Of (OBO) flow to exchange the user's access token
for a Graph-scoped token, then calls Graph on their behalf.

All public methods are best-effort: errors are logged and None/empty-dict is
returned so callers never have to handle Graph unavailability specially.
"""
import logging
from typing import Optional

import httpx

from api.app.config import Settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_ME_SELECT = "id,displayName,mail,userPrincipalName"


class GraphClient:
    """Thin async Graph client backed by the On-Behalf-Of token flow."""

    def __init__(self, user_access_token: str, settings: Settings) -> None:
        self._user_token = user_access_token
        self._settings = settings
        self._graph_token: Optional[str] = None

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    async def get_me(self) -> dict:
        """Return selected fields from /me, or {} on any error."""
        token = await self._get_graph_token()
        if not token:
            return {}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{_GRAPH_BASE}/me",
                    params={"$select": _ME_SELECT},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Graph /me call failed: %s", exc)
            return {}

    async def get_manager_object_id(self) -> Optional[str]:
        """Return the manager's Entra object_id, or None if not found / error."""
        token = await self._get_graph_token()
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{_GRAPH_BASE}/me/manager",
                    params={"$select": "id"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if resp.status_code == 404:
                    # User has no manager — clear the field
                    return None
                resp.raise_for_status()
                data = resp.json()
                return data.get("id") or None
        except Exception as exc:
            logger.warning("Graph /me/manager call failed: %s", exc)
            # Return sentinel so callers can distinguish "no manager" vs "error"
            return _MANAGER_FETCH_FAILED

    # ------------------------------------------------------------------
    # OBO token exchange
    # ------------------------------------------------------------------

    async def _get_graph_token(self) -> Optional[str]:
        """Exchange the user token for a Graph-scoped token via OBO."""
        if self._graph_token:
            return self._graph_token

        s = self._settings
        if not s.graph_client_id or not s.graph_client_secret or not s.azure_tenant_id:
            logger.debug(
                "Graph OBO skipped: GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / "
                "AZURE_TENANT_ID not configured."
            )
            return None

        token_url = (
            f"https://login.microsoftonline.com/{s.azure_tenant_id}/oauth2/v2.0/token"
        )
        payload = {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "client_id": s.graph_client_id,
            "client_secret": s.graph_client_secret,
            "assertion": self._user_token,
            "scope": "https://graph.microsoft.com/User.Read offline_access",
            "requested_token_use": "on_behalf_of",
        }

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(token_url, data=payload)
                resp.raise_for_status()
                self._graph_token = resp.json()["access_token"]
                return self._graph_token
        except Exception as exc:
            logger.warning("Graph OBO token exchange failed: %s", exc)
            return None


# Sentinel returned when the /me/manager call fails (distinct from "no manager" 404)
_MANAGER_FETCH_FAILED = "__GRAPH_ERROR__"
