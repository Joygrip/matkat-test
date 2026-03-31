# Outlook Email Notifications

## Architecture

Email is sent through **Microsoft Graph** (`POST /users/{from}/sendMail`) using an
app-only (client credentials) token — no user impersonation required.

```
trigger code
    └── send_notification(template_key, recipients, context)    [graph_mail.py]
            └── GraphMailService.send_mail(to, subject, html)   [graph_mail.py]
                    └── Graph POST /users/{mailbox}/sendMail

scheduled / admin-triggered phases
    └── NotificationsService.run_notifications(phase, year, month)  [notifications.py]
            └── GraphMailService.send_mail(...)
```

**Modes** (controlled by `NOTIFY_MODE`):

| Mode | Behaviour |
|------|-----------|
| `stub` (default) | Logs the intent, records the `NotificationLog` row as SENT, sends **no email**. Safe for dev/test. |
| `graph` | Acquires an app-only token from Entra and calls Graph. Fails clearly if credentials are missing. |

---

## Environment Variables

| Variable | Required for graph mode | Default | Description |
|---|---|---|---|
| `NOTIFY_MODE` | — | `stub` | `stub` or `graph` |
| `NOTIFY_FROM_EMAIL` | ✅ | _(empty)_ | UPN of the shared mailbox that sends mail (e.g. `notifications@company.com`) |
| `GRAPH_CLIENT_ID` | ✅ | _(empty)_ | Entra app registration client ID |
| `GRAPH_CLIENT_SECRET` | ✅ | _(empty)_ | Entra app registration client secret |
| `AZURE_TENANT_ID` | ✅ | _(empty)_ | Entra tenant GUID |
| `NOTIFY_CONFLICT_SCHEDULE` | — | `PM_RO` | Phase cadence that triggers conflict alert emails |
| `NOTIFY_MISSING_ACTUALS_SCHEDULE` | — | `Employee` | Phase cadence that triggers missing actuals emails |

---

## Azure / Entra / Graph Permissions

### App registration requirements

1. **`Mail.Send`** — Application permission (not delegated), **admin consent required**.
   Path: Entra portal → App registrations → your app → API permissions → Add → Microsoft Graph → Application permissions → `Mail.Send` → Grant admin consent.

2. The shared mailbox (`NOTIFY_FROM_EMAIL`) must exist as a licensed or shared mailbox in Exchange Online.
   The app registration does **not** need explicit mailbox-level permissions beyond `Mail.Send` on Graph, but the tenant admin must confirm the mailbox is reachable.

### Blocker

`Mail.Send` Application permission requires **Global Admin (or privileged role admin) consent** in Entra.
This cannot be granted by a regular app owner — flag this to your Azure administrator before enabling graph mode.

---

## How to Use in Code

```python
from api.app.services.graph_mail import send_notification

# Send a single templated email (no DB session or CurrentUser needed)
result = send_notification(
    template_key="planning_reminder",
    recipients=["alice@example.com", "bob@example.com"],
    context={"year": 2026, "month": 3, "deadline": "2026-03-06"},
)
# {"sent": ["alice@example.com", "bob@example.com"], "failed": [], "mode": "stub"}
```

Available template keys: `test`, `planning_reminder`, `finance_reminder`,
`actuals_reminder`, `approval_reminder`, `conflict_alert`, `missing_actuals`.

---

## Testing Locally (stub mode)

```bash
# Start API in dev mode — no Azure credentials needed
ENV=dev DEV_AUTH_BYPASS=true NOTIFY_MODE=stub uvicorn api.app.main:app --reload

# Verify smoke-test returns stub response
curl -s -X POST "http://localhost:8000/notifications/smoke-test" \
     -H "X-Dev-Role: Admin"
# {"status":"stub","to":"admin@dev.local","mode":"stub"}

# Run a phase notification — records logs, sends no email
curl -s -X POST "http://localhost:8000/notifications/run?phase=Employee&year=2026&month=3" \
     -H "X-Dev-Role: Admin"

# Inspect logs
curl -s "http://localhost:8000/notifications/logs" -H "X-Dev-Role: Admin"
```

---

## Testing in Azure / Staging (graph mode)

1. Set environment variables on the App Service / Container App:
   ```
   NOTIFY_MODE=graph
   NOTIFY_FROM_EMAIL=notifications@yourcompany.com
   GRAPH_CLIENT_ID=<app-registration-client-id>
   GRAPH_CLIENT_SECRET=<client-secret-value>
   AZURE_TENANT_ID=<entra-tenant-guid>
   ```

2. Log in as an Admin user and call the smoke-test endpoint:
   ```
   POST /notifications/smoke-test
   ```
   A test email will be delivered to your inbox from the shared mailbox.

3. Check application logs for any `GraphMailService` warnings if the email does not arrive.

---

## Notification Log

All sent (and failed) notifications are recorded in the `notification_logs` table.
Query via `GET /notifications/logs` (Admin or Finance role required).
