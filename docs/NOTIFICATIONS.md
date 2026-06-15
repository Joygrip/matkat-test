# Notifications

MatKat can send email reminders and alerts (planning, finance, actuals, approvals, conflict
alerts, missing actuals). Email is sent through **Microsoft Graph** using an app-only
(client-credentials) token — no user impersonation.

## Modes (`NOTIFY_MODE`)

| Mode | Behavior |
| --- | --- |
| `stub` (default) | Logs intent, records the `NotificationLog` row, sends **no email**. Safe for dev/test. |
| `graph` | Acquires an app-only Entra token and calls Microsoft Graph `sendMail`. Fails clearly if credentials are missing. |

## Environment variables

| Variable | Required for `graph` | Default | Description |
| --- | --- | --- | --- |
| `NOTIFY_MODE` | — | `stub` | `stub` or `graph` |
| `NOTIFY_FROM_EMAIL` | ✅ | _(empty)_ | UPN of the shared sender mailbox (e.g. `notifications@company.com`) |
| `GRAPH_CLIENT_ID` | ✅ | _(empty)_ | Entra app registration client ID |
| `GRAPH_CLIENT_SECRET` | ✅ | _(empty)_ | Entra app registration client secret |
| `AZURE_TENANT_ID` | ✅ | _(empty)_ | Entra tenant GUID |
| `NOTIFY_CONFLICT_SCHEDULE` | — | `PM_RO` | Phase cadence that triggers conflict-alert emails |
| `NOTIFY_MISSING_ACTUALS_SCHEDULE` | — | `Employee` | Phase cadence that triggers missing-actuals emails |

Keep secrets in environment/app settings only — never commit them.

## Graph permissions

- The app registration needs **`Mail.Send`** as an **Application** permission (not
  delegated), with **admin consent**. (Entra portal → App registrations → your app → API
  permissions → Microsoft Graph → Application permissions → `Mail.Send` → grant admin consent.)
- The `NOTIFY_FROM_EMAIL` mailbox must exist as a licensed or shared mailbox in Exchange Online.
- **Blocker:** `Mail.Send` (Application) requires Global/Privileged-role admin consent — a
  regular app owner cannot grant it. Flag this to your Azure admin before enabling `graph` mode.

## Phases and schedules

Notification phases (`NotificationLog.phase`): `PM_RO`, `Finance`, `Employee`,
`RO_Director`, `ConflictAlert`, `MissingActuals`.

Per-tenant **NotificationSchedule** rows control when each notification type fires and who
receives it:

- `notification_type`: `conflict_alerts`, `missing_actuals`, `planning_reminder`,
  `approval_reminder`, `approval_rejection`.
- `trigger_type`: `day_of_month`, `day_of_week`, or `days_before_period_close`, with a
  `trigger_value` and `time_of_day` (UTC).
- Recipient flags: `notify_pm`, `notify_manager`, `notify_finance`, `notify_employee`;
  `excluded_emails` opts specific addresses out.

Each send is recorded in `NotificationLog` with a `status` (pending/sent/failed),
`run_id`, and a unique `idempotency_key` so the same notification is not sent twice.

## Scheduler (`scheduler/`)

`scheduler/` is an **Azure Functions** timer project that fires notification phases on a
cadence and calls the API. It is a deployment component, not part of the local web app.

Local development:

```bash
# 1. Start the API (see OPERATIONS.md)
# 2. From scheduler/, with Azure Functions Core Tools installed:
func start
```

Configure via `scheduler/local.settings.json` (local) or app settings (Azure):
`API_BASE_URL`, and — for local dev against the bypass — `DEV_AUTH_BYPASS`, `DEV_TENANT`,
`DEV_ROLE`. In production use a managed identity and **do not** set the dev-bypass values.

## Testing locally (stub mode)

No Azure credentials are needed in `stub` mode. With the API running under
`ENV=dev DEV_AUTH_BYPASS=true NOTIFY_MODE=stub`, the notification endpoints record
`NotificationLog` rows and return a stub response without sending email. Inspect results via
the notification logs endpoint (Admin/Finance).

## Testing in Azure / staging (graph mode)

1. Set `NOTIFY_MODE=graph` plus `NOTIFY_FROM_EMAIL`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET`, `AZURE_TENANT_ID` on the App Service / Container App.
2. Trigger a test send as an Admin and confirm delivery from the shared mailbox.
3. If mail doesn't arrive, check application logs for `GraphMailService` warnings and verify
   the `Mail.Send` admin consent and mailbox.

## Notification log

All sent and failed notifications are recorded in the `notification_logs` table and are
queryable by Admin/Finance.
