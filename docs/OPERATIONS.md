# Operations

Practical day-to-day operational knowledge. For deeper architecture see
[ARCHITECTURE.md](ARCHITECTURE.md); for backend specifics see [BACKEND.md](BACKEND.md).

## Local run

From the repo root (`<repo-root>`):

```powershell
# Backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH = (Get-Location).Path
$env:ENV = "dev"; $env:DEV_AUTH_BYPASS = "true"; $env:DATABASE_URL = "sqlite:///./api/dev.db"
uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (separate terminal)
cd frontend
npm run dev
```

Or use the helper scripts: `.\scripts\start-all.ps1` (both),
`.\scripts\start-backend.ps1`, `.\scripts\start-frontend.ps1`.

Verify:

- API health: <http://localhost:8000/healthz>
- API docs: <http://localhost:8000/docs>
- Frontend: <http://localhost:5173>

### Dev data / seeding

With `DEV_AUTH_BYPASS=true`, the backend **auto-seeds full example data** on startup when
the database is empty (periods, demand/supply, signed actuals, approvals). To reset:

- `POST /dev/seed-reset` — wipes tenant data and re-seeds full example data, or
- delete `api/dev.db` and restart the backend.

`POST /dev/seed` still exists but creates only minimal data; prefer the auto-seed or
`seed-reset`. Use the **Dev Login** panel to switch role/tenant.

## Tests / build

```powershell
# Backend
cd api
pytest

# Frontend
cd ../frontend
npx tsc --noEmit
npm run build
npm run test
```

## Migrations

Apply schema changes with Alembic, against the **same database** the backend uses:

```powershell
cd api
python -m alembic upgrade head
```

A fresh local DB does not usually need a manual migration (the dev seed handles an empty
DB), but `upgrade head` brings an existing DB current.

## Graph sync (overview)

Microsoft Graph is the source of truth for users, departments (→ cost centers), and manager
chains. Admin endpoints run the sync (idempotent — safe to repeat):

| Endpoint | Action |
| --- | --- |
| `POST /sync/import-graph-users` | Bulk-import Entra users. |
| `POST /sync/graph-users` | Refresh profiles + reporting cache. |
| `POST /sync/import-departments` | Import Graph departments as cost centers. |
| `POST /sync/promote-managers` | Promote Employees who manage others to Manager. |
| `POST /sync/create-resources` | Create Resource rows for active users. |
| `POST /sync/assign-cost-center-managers` | Auto-assign RO/Director on cost centers. |
| `POST /sync/full` | Run all steps in sequence. |

A department rename creates a **new** cost center and soft-deletes the old one;
`sync_protected` cost centers skip user reassignment; RO/Director are written only when
currently unset. Graph sync requires `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` configured;
leave them empty to disable sync.

## Notifications (overview)

Email notifications run in **stub** mode by default (logged, no email) or **graph** mode
(sent via Microsoft Graph). Schedules are configured per tenant and executed by the
notifications service / the `scheduler/` Azure Functions project. Full details, environment
variables, and templates are in [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Deployment (high level)

- API → Azure App Service / containers; frontend → Azure Static Web Apps; database → Azure SQL.
- Configuration (Entra IDs, `DATABASE_URL`, Graph credentials, `NOTIFY_*`) is set via app
  settings — never committed.
- Apply Alembic migrations as part of release. Keep deployment tokens and secrets out of the repo.

## Troubleshooting

### Backend won't start

- Run from the **repo root** with `PYTHONPATH` set to it, or imports of `api.app.main` fail.
- Ensure the venv is activated and `pip install -r api/requirements-dev.txt` has run.
- If port 8000 is busy: `Get-NetTCPConnection -LocalPort 8000` then stop the owning process.

### Frontend "Cannot reach API" / HTTP 0

- In dev, leave `VITE_API_BASE_URL` **unset** so the Vite proxy forwards `/api` to
  `http://localhost:8000` (same-origin, no CORS).
- Confirm the backend is running (`/healthz` returns 200).
- If you do set `VITE_API_BASE_URL`, the frontend calls the API cross-origin — ensure the
  origin is allowed (`http://localhost:5173` / `http://127.0.0.1:5173` are allowed by
  default; add others via `ADDITIONAL_CORS_ORIGINS` in `api/.env`).

### Database migration / "no such column"

- The backend is using a database that predates a schema change. Run
  `python -m alembic upgrade head` from `api/` against the **same** `DATABASE_URL` the
  backend uses, or delete `api/dev.db` and restart for a clean seeded DB.

### CORS / local proxy

- Prefer the Vite proxy in dev (leave `VITE_API_BASE_URL` unset). Only configure
  `ADDITIONAL_CORS_ORIGINS` when accessing the frontend from a non-default origin.

### Auth / dev bypass safety

- Dev bypass works only with `ENV=dev` **and** `DEV_AUTH_BYPASS=true`. If role switching
  doesn't take effect, confirm both flags and that `VITE_DEV_AUTH_BYPASS=true` on the frontend.
- **Never** enable dev bypass in production.

> Note: one-off operational/diagnostic/cleanup scripts have been retired from the
> repository and are **not** part of the operational workflow. Use Alembic for schema
> changes and the application's own endpoints for data operations.
