"""Microsoft Graph API mail sender using the client credentials (app-only) flow.

Mirrors GraphAppClient exactly — synchronous httpx, same FETCH_FAILED sentinel,
same token caching strategy. Used exclusively by the notification services to
send Outlook emails without impersonating any specific user.

Required Entra app registration permissions:
    Mail.Send  (Application permission, admin consent required)

Required environment variables (on top of existing Graph credentials):
    NOTIFY_FROM_EMAIL  — UPN / email of the shared mailbox that sends mail
    GRAPH_CLIENT_ID    — (already required by GraphAppClient)
    GRAPH_CLIENT_SECRET — (already required by GraphAppClient)
    AZURE_TENANT_ID    — (already required by GraphAppClient)
    NOTIFY_MODE        — "stub" (default, log only) or "graph" (real send)

Simple API for trigger code
---------------------------
Future callers that don't need phase-level orchestration can use the
module-level ``send_notification`` function::

    from api.app.services.graph_mail import send_notification

    result = send_notification(
        template_key="planning_reminder",
        recipients=["alice@example.com"],
        context={"year": 2026, "month": 3, "deadline": "2026-03-06"},
    )
    # {"sent": [...], "failed": [...], "mode": "stub"|"graph"}
"""
import logging
from typing import Optional

import httpx

from api.app.config import Settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------
# Each entry: {"subject": "...", "body": "..."}
# Body supports {placeholder} substitution via str.format_map(context).
# Add new templates here; trigger code uses send_notification(key, ...).

NOTIFICATION_TEMPLATES: dict[str, dict[str, str]] = {
    "test": {
        "subject": "MatKat: Notification smoke-test",
        "body": "This is a test message from MatKat. If you received this, Graph mail is configured correctly.",
    },
    "planning_reminder": {
        "subject": "MatKat: Planning reminder",
        "body": (
            "Reminder: Please complete demand and supply planning for "
            "{month:02d}/{year} by {deadline}."
        ),
    },
    "finance_reminder": {
        "subject": "MatKat: Finance consolidation reminder",
        "body": (
            "Reminder: Planning data for {month:02d}/{year} is ready for review. "
            "Please consolidate by {deadline}."
        ),
    },
    "actuals_reminder": {
        "subject": "MatKat: Actuals entry reminder",
        "body": "Reminder: Please enter your actuals for {month:02d}/{year} by {deadline}.",
    },
    "approval_reminder": {
        "subject": "MatKat: Actuals approval reminder",
        "body": (
            "Reminder: Actuals for {month:02d}/{year} are awaiting your approval. "
            "Please review by {deadline}."
        ),
    },
    "conflict_alert": {
        "subject": "MatKat: Resource allocation conflict detected",
        "body": (
            "Resource allocation conflict detected for {resource_name} "
            "in {month:02d}/{year}: total demand is {total_demand}% FTE but "
            "supply is only {total_supply}% FTE. "
            "Please review and adjust demand or supply lines."
        ),
    },
    "missing_actuals": {
        "subject": "MatKat: Actuals submission reminder",
        "body": (
            "Reminder: Actuals for {month:02d}/{year} have not been fully submitted "
            "for {resource_name}. Please sign your actual lines as soon as possible."
        ),
    },
}

# Sentinel returned when a Graph call fails with a network / auth error.
# Callers use `is` identity check to distinguish from a legitimate None value.
FETCH_FAILED = "__GRAPH_MAIL_ERROR__"


class GraphMailService:
    """Send email via Graph API POST /users/{from}/sendMail.

    Token is cached per-instance (valid for ~3600 s, fine for a single
    notification run). Errors are logged and False is returned so callers
    never need to handle Graph unavailability specially.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._token: Optional[str] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def send_mail(self, to_email: str, subject: str, body_html: str) -> bool:
        """Send one email to *to_email*.

        Returns:
            True   — sent successfully (or stub mode, no-op)
            False  — send failed (error already logged)

        In stub mode (notify_mode != "graph") the call is a no-op and returns
        True so callers can record the log entry as SENT without actual sending.
        """
        if self._settings.notify_mode != "graph":
            logger.debug(
                "GraphMailService: stub mode — skipping sendMail to %s (subject: %s)",
                to_email,
                subject,
            )
            return True

        if not self._settings.notify_from_email:
            logger.warning(
                "GraphMailService: NOTIFY_FROM_EMAIL is not configured — cannot send mail."
            )
            return False

        token = self._get_token()
        if token is FETCH_FAILED:
            return False

        url = f"{_GRAPH_BASE}/users/{self._settings.notify_from_email}/sendMail"
        payload = self._build_payload(to_email, subject, body_html)

        try:
            with httpx.Client(timeout=15) as client:
                resp = client.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                )
                # Graph returns 202 Accepted on success (no body)
                if resp.status_code == 202:
                    logger.info(
                        "GraphMailService: mail sent to %s (subject: %s)", to_email, subject
                    )
                    return True
                logger.warning(
                    "GraphMailService: sendMail returned %s for %s — %s",
                    resp.status_code,
                    to_email,
                    resp.text[:200],
                )
                return False
        except Exception as exc:
            logger.warning("GraphMailService: sendMail to %s failed: %s", to_email, exc)
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_payload(self, to_email: str, subject: str, body_html: str) -> dict:
        return {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "HTML",
                    "content": body_html,
                },
                "toRecipients": [
                    {"emailAddress": {"address": to_email}},
                ],
            },
            "saveToSentItems": False,
        }

    def _get_token(self) -> Optional[str]:
        """Acquire (or return cached) an app-only Graph token.

        Returns the token string on success, or FETCH_FAILED sentinel on error.
        """
        if self._token:
            return self._token

        s = self._settings
        if not s.graph_client_id or not s.graph_client_secret or not s.azure_tenant_id:
            logger.debug(
                "GraphMailService: skipped — GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / "
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
                resp.raise_for_status()
                self._token = resp.json()["access_token"]
                return self._token
        except Exception as exc:
            logger.warning("GraphMailService: token acquisition failed: %s", exc)
            return FETCH_FAILED


# ---------------------------------------------------------------------------
# Module-level convenience function
# ---------------------------------------------------------------------------

def send_notification(
    template_key: str,
    recipients: list[str],
    context: dict,
) -> dict[str, object]:
    """Send an email notification using a named template.

    Stateless — no DB session or CurrentUser required. Intended for use by
    background jobs, scheduler functions, and future trigger code.

    Args:
        template_key: Key from NOTIFICATION_TEMPLATES (e.g. "planning_reminder").
        recipients:   List of recipient email addresses.
        context:      Dict of values for {placeholder} substitution in the template.

    Returns:
        {"sent": [<emails>], "failed": [<emails>], "mode": "stub"|"graph"}

    Raises:
        ValueError: If template_key is not found in NOTIFICATION_TEMPLATES.
    """
    from api.app.config import get_settings  # local import avoids circular at module load

    template = NOTIFICATION_TEMPLATES.get(template_key)
    if template is None:
        raise ValueError(
            f"Unknown notification template: {template_key!r}. "
            f"Available: {list(NOTIFICATION_TEMPLATES)}"
        )

    settings = get_settings()
    mail = GraphMailService(settings)

    try:
        subject = template["subject"].format_map(context)
        body_text = template["body"].format_map(context)
    except KeyError as exc:
        raise ValueError(
            f"Template '{template_key}' requires context key {exc} which was not provided."
        ) from exc

    body_html = (
        f"<html><body>"
        f"<p>{body_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}</p>"
        f"<p style='color:#888;font-size:12px;'>This is an automated message from MatKat.</p>"
        f"</body></html>"
    )

    sent: list[str] = []
    failed: list[str] = []
    for email in recipients:
        ok = mail.send_mail(to_email=email, subject=subject, body_html=body_html)
        (sent if ok else failed).append(email)

    logger.info(
        "send_notification: template=%s sent=%d failed=%d mode=%s",
        template_key,
        len(sent),
        len(failed),
        settings.notify_mode,
    )
    return {"sent": sent, "failed": failed, "mode": settings.notify_mode}
