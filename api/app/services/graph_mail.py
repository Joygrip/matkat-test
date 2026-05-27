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
        context={"year": 2026, "month": 3, "month_name": "March", "deadline": "2026-03-06"},
    )
    # {"sent": [...], "failed": [...], "mode": "stub"|"graph"}
"""
import base64
import logging
import os
import time
from typing import Optional

import httpx

from api.app.config import Settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
EMAIL_STAGGER_SECONDS = 15

# ---------------------------------------------------------------------------
# Logo — embedded as base64 so email clients don't block external images
# ---------------------------------------------------------------------------

_LOGO_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", "MatKatLog.png")
)
try:
    with open(_LOGO_PATH, "rb") as _f:
        _LOGO_SRC = f"data:image/png;base64,{base64.b64encode(_f.read()).decode()}"
except Exception:
    _LOGO_SRC = ""  # fallback: show text instead of broken image

# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------
# Each entry: {"subject": "...", "body": "..."}
# Body is used as plain-text fallback for templates without a dedicated HTML builder.
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
    "approval_rejection": {
        "subject": "MatKat — Your actual was rejected",
        "body": (
            "Your actual for {project_name} ({period}) was rejected by {rejector_name}."
        ),
    },
}

# Sentinel returned when a Graph call fails with a network / auth error.
# Callers use `is` identity check to distinguish from a legitimate None value.
FETCH_FAILED = "__GRAPH_MAIL_ERROR__"

# ---------------------------------------------------------------------------
# Banner style configs per template key
# ---------------------------------------------------------------------------

_BANNER_CONFIGS: dict[str, tuple[str, str, str]] = {
    # (bg, left_border, title_color)
    "conflict_alert":      ("#fee2e2", "#dc2626", "#991b1b"),
    "missing_actuals":     ("#fef9c3", "#ca8a04", "#854d0e"),
    "planning_reminder":   ("#dbeafe", "#2563eb", "#1e40af"),
    "approval_reminder":   ("#ffedd5", "#ea580c", "#9a3412"),
    "approval_rejection":  ("#fee2e2", "#dc2626", "#991b1b"),
    "test":                ("#dcfce7", "#16a34a", "#166534"),
}


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

def _esc(text: object) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _cta_button(label: str) -> str:
    return (
        f'<div style="margin-top:16px;">'
        f'<a style="display:inline-block;background:#1e3a5f;color:#ffffff;'
        f'padding:10px 20px;border-radius:6px;font-family:Arial,sans-serif;'
        f'font-size:13px;font-weight:bold;text-decoration:none;">'
        f'{_esc(label)}'
        f'</a></div>'
    )


def _build_base_html(
    banner_bg: str,
    banner_border: str,
    banner_title_color: str,
    banner_title: str,
    banner_subtitle: str,
    body_html: str,
) -> str:
    """Assemble the full card-style email HTML with header, banner, body, and footer."""
    logo_html = (
        f"<img src='{_LOGO_SRC}' alt='MatKat' height='40' "
        "style='height:40px;width:auto;display:block;' />"
        if _LOGO_SRC else
        "<span style='font-family:Arial,sans-serif;font-size:20px;"
        "font-weight:bold;color:#ffffff;'>MatKat</span>"
    )
    return (
        "<!DOCTYPE html>"
        "<html><body style='margin:0;padding:0;background-color:#ffffff;"
        "font-family:Arial,sans-serif;'>"
        "<table width='100%' cellpadding='0' cellspacing='0' "
        "style='background-color:#ffffff;'>"
        "<tr><td align='center' style='padding:0;'>"
        "<table width='600' cellpadding='0' cellspacing='0' "
        "style='max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;"
        "border:1px solid #e0e0e0;'>"
        # ── Header ──────────────────────────────────────────────────────────
        "<tr>"
        "<td style='background:#1e3a5f;padding:20px 28px;'>"
        "<table cellpadding='0' cellspacing='0'><tr>"
        f"<td style='vertical-align:middle;'>{logo_html}</td>"
        "<td style='padding-left:12px;vertical-align:middle;"
        "font-family:Arial,sans-serif;font-size:13px;color:#4a9eff;'>"
        "FeMD Resource Allocation"
        "</td>"
        "</tr></table>"
        "</td>"
        "</tr>"
        # ── Alert banner ─────────────────────────────────────────────────────
        "<tr>"
        f"<td style='background:{banner_bg};border-left:4px solid {banner_border};"
        "padding:14px 28px;'>"
        f"<div style='font-family:Arial,sans-serif;font-size:14px;font-weight:bold;"
        f"color:{banner_title_color};'>{_esc(banner_title)}</div>"
        f"<div style='font-family:Arial,sans-serif;font-size:12px;"
        f"color:{banner_title_color};margin-top:4px;'>{_esc(banner_subtitle)}</div>"
        "</td>"
        "</tr>"
        # ── Body ─────────────────────────────────────────────────────────────
        "<tr>"
        "<td style='background:#ffffff;padding:24px 28px;'>"
        f"{body_html}"
        "</td>"
        "</tr>"
        # ── Footer ───────────────────────────────────────────────────────────
        "<tr>"
        "<td style='background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 28px;'>"
        "<p style='margin:0;font-family:Arial,sans-serif;font-size:11px;"
        "color:#9ca3af;line-height:1.5;'>"
        "This is an automated message from MatKat. Please do not reply to this email."
        "</p>"
        "<p style='margin:4px 0 0;font-family:Arial,sans-serif;font-size:11px;"
        "color:#9ca3af;line-height:1.5;'>"
        "Sent from matkat-noreply@ferrosanmd.com"
        "</p>"
        "</td>"
        "</tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</body></html>"
    )


# ---------------------------------------------------------------------------
# Per-template HTML builders
# ---------------------------------------------------------------------------

def _build_conflict_alert_html(context: dict) -> str:
    year = context["year"]
    month_name = context["month_name"]
    conflicts = context.get("conflicts", [])

    rows = ""
    for i, c in enumerate(conflicts):
        row_bg = "#ffffff" if i % 2 == 0 else "#f9fafb"
        gap = c["gap"]
        gap_str = f"{gap:.0f}%"
        if gap < 0:
            badge = (
                f"<span style='display:inline-block;background:#fee2e2;color:#991b1b;"
                f"padding:3px 8px;border-radius:4px;font-size:12px;"
                f"font-weight:bold;font-family:Arial,sans-serif;'>"
                f"{gap_str}</span>"
            )
        else:
            badge = (
                f"<span style='display:inline-block;background:#dcfce7;color:#166534;"
                f"padding:3px 8px;border-radius:4px;font-size:12px;"
                f"font-weight:bold;font-family:Arial,sans-serif;'>"
                f"+{gap_str}</span>"
            )
        rows += (
            f"<tr style='background:{row_bg};'>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(c['resource_name'])}</td>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;'>{_esc(c['total_demand'])}%</td>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;'>{_esc(c['total_supply'])}%</td>"
            f"<td style='padding:10px 12px;text-align:center;border-bottom:1px solid #f3f4f6;'>{badge}</td>"
            f"</tr>"
        )

    table = (
        "<table width='100%' cellpadding='0' cellspacing='0' "
        "style='border-collapse:collapse;border:1px solid #e5e7eb;margin:16px 0;'>"
        "<thead><tr style='background:#f9fafb;'>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Resource</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:right;"
        "border-bottom:1px solid #e5e7eb;'>Demand</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:right;"
        "border-bottom:1px solid #e5e7eb;'>Supply</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:center;"
        "border-bottom:1px solid #e5e7eb;'>Gap</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )

    body_html = (
        f"<p style='margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        f"The following resources have demand that exceeds available supply for "
        f"{_esc(month_name)} {_esc(year)}. Please review and adjust demand or supply lines in MatKat."
        f"</p>"
        f"{table}"
    )

    bg, border, title_color = _BANNER_CONFIGS["conflict_alert"]
    return _build_base_html(
        banner_bg=bg,
        banner_border=border,
        banner_title_color=title_color,
        banner_title="Resource Conflict Detected",
        banner_subtitle=f"{month_name} {year} — Action required",
        body_html=body_html,
    )


def _build_missing_actuals_html(context: dict) -> str:
    year = context["year"]
    month_name = context["month_name"]

    resources = context.get("resources")
    resource_name = context.get("resource_name")

    if resources:
        items_html = "".join(
            f"<li style='font-family:Arial,sans-serif;font-size:14px;color:#374151;"
            f"margin-bottom:4px;'>{_esc(r)}</li>"
            for r in resources
        )
        list_html = f"<ul style='margin:12px 0;padding-left:20px;'>{items_html}</ul>"
    elif resource_name:
        list_html = (
            f"<ul style='margin:12px 0;padding-left:20px;'>"
            f"<li style='font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
            f"{_esc(resource_name)}</li></ul>"
        )
    else:
        list_html = ""

    body_html = (
        f"<p style='margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        f"The following actuals have not been submitted for {_esc(month_name)} {_esc(year)}. "
        f"Please log in to MatKat and submit your actuals before the period closes."
        f"</p>"
        f"{list_html}"
        f"{_cta_button('Submit Actuals in MatKat →')}"
    )

    bg, border, title_color = _BANNER_CONFIGS["missing_actuals"]
    return _build_base_html(
        banner_bg=bg,
        banner_border=border,
        banner_title_color=title_color,
        banner_title="Actuals Submission Required",
        banner_subtitle=f"{month_name} {year} — Please act now",
        body_html=body_html,
    )


def _build_planning_reminder_html(context: dict) -> str:
    year = context["year"]
    month_name = context["month_name"]
    deadline = context.get("deadline", "")

    body_html = (
        f"<p style='margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        f"Please complete your demand and supply planning for {_esc(month_name)} {_esc(year)} "
        f"by {_esc(deadline)}."
        f"</p>"
        f"<p style='margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        f"Log in to MatKat to review and update your planning lines."
        f"</p>"
        f"{_cta_button('Open MatKat →')}"
    )

    bg, border, title_color = _BANNER_CONFIGS["planning_reminder"]
    return _build_base_html(
        banner_bg=bg,
        banner_border=border,
        banner_title_color=title_color,
        banner_title="Planning Reminder",
        banner_subtitle=f"Deadline: {_esc(deadline)}",
        body_html=body_html,
    )


def _build_approval_reminder_html(context: dict) -> str:
    year = context["year"]
    month_name = context["month_name"]
    deadline = context.get("deadline", "")
    approvals = context.get("approvals", [])
    total = context.get("total", len(approvals))

    rows = ""
    for i, a in enumerate(approvals):
        row_bg = "#ffffff" if i % 2 == 0 else "#f9fafb"
        rows += (
            f"<tr style='background:{row_bg};'>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(a['resource_name'])}</td>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(a['project_name'])}</td>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;'>{_esc(a['fte_percent'])}%</td>"
            f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
            f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(a['period'])}</td>"
            f"</tr>"
        )

    table = (
        "<table width='100%' cellpadding='0' cellspacing='0' "
        "style='border-collapse:collapse;border:1px solid #e5e7eb;margin:16px 0;'>"
        "<thead><tr style='background:#f9fafb;'>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Employee</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Project</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:right;"
        "border-bottom:1px solid #e5e7eb;'>FTE%</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Period</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )

    body_html = (
        f"<p style='margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        f"The following approval{'s' if total != 1 else ''} require your action before {_esc(deadline)}."
        f"</p>"
        f"{table}"
        f"{_cta_button('Review Approvals in MatKat →')}"
    )

    bg, border, title_color = _BANNER_CONFIGS["approval_reminder"]
    return _build_base_html(
        banner_bg=bg,
        banner_border=border,
        banner_title_color=title_color,
        banner_title="Approvals Awaiting Your Action",
        banner_subtitle=f"{total} approval{'s' if total != 1 else ''} pending for {month_name} {year}",
        body_html=body_html,
    )


def _build_test_html(_context: dict) -> str:
    body_html = (
        "<p style='margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        "This is a test message from MatKat."
        "</p>"
        "<p style='margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        "If you received this, Microsoft Graph mail is configured correctly."
        "</p>"
    )

    bg, border, title_color = _BANNER_CONFIGS["test"]
    return _build_base_html(
        banner_bg=bg,
        banner_border=border,
        banner_title_color=title_color,
        banner_title="Configuration Test",
        banner_subtitle="Graph mail is working",
        body_html=body_html,
    )


def _build_approval_rejection_html(context: dict) -> str:
    employee_name = context.get("employee_name", "")
    project_name = context.get("project_name", "")
    period = context.get("period", "")
    fte_percent = context.get("fte_percent", "")
    rejector_name = context.get("rejector_name", "")
    comment = context.get("comment")

    row = (
        "<tr style='background:#ffffff;'>"
        f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(employee_name)}</td>"
        f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(project_name)}</td>"
        f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(period)}</td>"
        f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        f"color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;'>{_esc(fte_percent)}%</td>"
        f"<td style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        f"color:#111827;border-bottom:1px solid #f3f4f6;'>{_esc(rejector_name)}</td>"
        "</tr>"
    )

    table = (
        "<table width='100%' cellpadding='0' cellspacing='0' "
        "style='border-collapse:collapse;border:1px solid #e5e7eb;margin:16px 0;'>"
        "<thead><tr style='background:#f9fafb;'>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Employee</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Project</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Period</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:right;"
        "border-bottom:1px solid #e5e7eb;'>FTE%</th>"
        "<th style='padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;"
        "font-weight:bold;color:#6b7280;text-align:left;"
        "border-bottom:1px solid #e5e7eb;'>Rejected By</th>"
        f"</tr></thead><tbody>{row}</tbody></table>"
    )

    comment_html = ""
    if comment:
        comment_html = (
            "<blockquote style='margin:16px 0 0;padding:12px 16px;"
            "background:#fef2f2;border-left:4px solid #dc2626;"
            "font-family:Arial,sans-serif;font-size:13px;color:#991b1b;'>"
            f"<strong>Reason:</strong> {_esc(comment)}"
            "</blockquote>"
        )

    body_html = (
        f"<p style='margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:#374151;'>"
        f"Your actual for <strong>{_esc(project_name)}</strong> ({_esc(period)}) "
        f"was rejected by {_esc(rejector_name)}. Please review and resubmit."
        f"</p>"
        f"{table}"
        f"{comment_html}"
    )

    bg, border, title_color = _BANNER_CONFIGS["approval_rejection"]
    return _build_base_html(
        banner_bg=bg,
        banner_border=border,
        banner_title_color=title_color,
        banner_title="Actual Rejected",
        banner_subtitle=f"{project_name} — {period}",
        body_html=body_html,
    )


_HTML_BUILDERS = {
    "conflict_alert":     _build_conflict_alert_html,
    "missing_actuals":    _build_missing_actuals_html,
    "planning_reminder":  _build_planning_reminder_html,
    "approval_reminder":  _build_approval_reminder_html,
    "approval_rejection": _build_approval_rejection_html,
    "test":               _build_test_html,
}


def build_conflict_alert_html(context: dict) -> str:
    """Build rich card-style HTML for a conflict alert with a structured conflict list.

    context keys:
        year, month, month_name — period info
        conflicts — list of dicts with resource_name, total_demand, total_supply, gap
    """
    return _build_conflict_alert_html(context)


def build_approval_reminder_html(context: dict) -> str:
    """Build rich card-style HTML for an approval reminder with a structured approval table.

    context keys:
        year, month, month_name, deadline — period and deadline info
        approvals — list of dicts with resource_name, project_name, fte_percent, period
        total — total number of pending approvals
    """
    return _build_approval_reminder_html(context)


def build_approval_rejection_html(context: dict) -> str:
    """Build rich card-style HTML for an actual rejection notification.

    context keys:
        employee_name, project_name, period, fte_percent, rejector_name — rejection details
        comment — optional rejection reason (may be None)
    """
    return _build_approval_rejection_html(context)


def build_phase_html(template_key: str, message: str, year: int, month: int) -> str:
    """Build card-style HTML for a plain-text notification message.

    Used by NotificationsService._dispatch_mail to wrap log messages in the
    appropriate banner style without requiring structured context.
    """
    import calendar as cal

    banner_titles = {
        "conflict_alert":    ("Resource Conflict Detected", "Action required"),
        "missing_actuals":   ("Actuals Submission Required", "Please act now"),
        "planning_reminder": ("Planning Reminder", "Please complete your planning"),
        "approval_reminder": ("Approval Required", "Review pending"),
        "test":              ("Configuration Test", "Graph mail is working"),
    }

    key = template_key if template_key in _BANNER_CONFIGS else "test"
    bg, border, title_color = _BANNER_CONFIGS[key]
    title, subtitle_fallback = banner_titles.get(key, ("Notification", ""))
    month_name = cal.month_name[month] if 1 <= month <= 12 else ""
    subtitle = f"{month_name} {year}" if month_name and year else subtitle_fallback

    safe = _esc(message).replace("\n\n", "</p><p style='margin:0 0 12px;"
                                 "font-family:Arial,sans-serif;font-size:14px;color:#374151;'>")
    safe = safe.replace("\n", "<br/>")
    body_html = (
        f"<p style='margin:0 0 12px;font-family:Arial,sans-serif;"
        f"font-size:14px;color:#374151;'>{safe}</p>"
    )

    return _build_base_html(bg, border, title_color, title, subtitle, body_html)


# ---------------------------------------------------------------------------
# GraphMailService
# ---------------------------------------------------------------------------


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
            False  — send failed after all retry attempts (error already logged)

        In stub mode (notify_mode != "graph") the call is a no-op and returns
        True so callers can record the log entry as SENT without actual sending.

        Transient failures (network errors, 429, 5xx) are retried up to 3 times
        with 0 / 1 / 2 second delays. Non-retryable 4xx errors fail immediately.
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
        _RETRY_DELAYS = (0, 1, 2)  # seconds before attempt 1, 2, 3

        for attempt, delay in enumerate(_RETRY_DELAYS):
            if delay:
                time.sleep(delay)
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
                        "GraphMailService: mail sent to %s (attempt %d)", to_email, attempt + 1
                    )
                    logger.info(
                        "GraphMailService: staggering %ds before next send", EMAIL_STAGGER_SECONDS
                    )
                    time.sleep(EMAIL_STAGGER_SECONDS)
                    return True
                # 4xx (except 429 Too Many Requests) are client errors that
                # will not resolve by retrying — fail immediately.
                if 400 <= resp.status_code < 500 and resp.status_code != 429:
                    logger.warning(
                        "GraphMailService: non-retryable %s for %s — %s",
                        resp.status_code,
                        to_email,
                        resp.text[:200],
                    )
                    return False
                logger.warning(
                    "GraphMailService: retryable %s for %s (attempt %d of %d)",
                    resp.status_code,
                    to_email,
                    attempt + 1,
                    len(_RETRY_DELAYS),
                )
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                logger.warning(
                    "GraphMailService: transient network error to %s (attempt %d of %d): %s",
                    to_email,
                    attempt + 1,
                    len(_RETRY_DELAYS),
                    exc,
                )
            except Exception as exc:
                logger.warning("GraphMailService: sendMail to %s failed: %s", to_email, exc)
                return False

        logger.warning(
            "GraphMailService: all %d attempts failed for %s", len(_RETRY_DELAYS), to_email
        )
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
        context:      Dict of values for {placeholder} substitution / HTML builder.

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
    except KeyError as exc:
        raise ValueError(
            f"Template '{template_key}' requires context key {exc} which was not provided."
        ) from exc

    builder = _HTML_BUILDERS.get(template_key)
    if builder:
        body_html = builder(context)
    else:
        # Fallback for templates without a dedicated HTML builder
        try:
            body_text = template["body"].format_map(context)
        except KeyError as exc:
            raise ValueError(
                f"Template '{template_key}' requires context key {exc} which was not provided."
            ) from exc
        safe = body_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        body_html = (
            f"<html><body>"
            f"<p>{safe}</p>"
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
