# Backend

FastAPI service under `api/`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the layering and
[DATA_MODEL.md](DATA_MODEL.md) for the schema.

## Startup

Run from the **repo root** so `api.app.main` imports resolve:

```powershell
# PowerShell
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH = (Get-Location).Path
$env:ENV = "dev"
$env:DEV_AUTH_BYPASS = "true"
$env:DATABASE_URL = "sqlite:///./api/dev.db"
uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
```

The app factory (`api/app/main.py`) registers routers, configures CORS, and — in dev with
an empty database — auto-seeds full example data. Health check: `GET /healthz`. Interactive
API docs: `/docs`.

## Main routers (`api/app/routers/`)

| Router | Responsibility |
| --- | --- |
| `health.py` | `GET /healthz` — status/version/environment. |
| `me.py` | `GET /me` — current identity, role, secondary role, capability flags, permissions. |
| `dev.py` | Dev-only seeding/inspection (gated by `ENV=dev` + `DEV_AUTH_BYPASS`). |
| `planning.py` | Demand and supply lines: list/create/update/delete, group move/delete, bulk; placeholder creation. |
| `actuals.py` | Actuals CRUD, sign/unsign, resubmit, proxy-sign; approval actions. |
| `project_costs.py` | Out-of-pocket (external) and equipment cost lines per project/period. |
| `consolidation.py` | Finance cost overview dashboard and snapshot publishing. |
| `admin.py` | Users, cost centers, projects + PM assignment, resources, placeholders, holidays, settings, delegates, and Graph sync endpoints. |

## Service layer (`api/app/services/`)

Business logic and scoping live here, not in routers:

- `planning.py` — demand/supply rules, scoping, group operations, and the
  `cleanup_unused_placeholders()` **hard-delete** of unreferenced placeholders after demand mutations.
- `actuals.py` — actuals creation/sign/approval routing (Manager → Director), proxy-sign, resubmit.
- `consolidation.py` — cost aggregation, Manager+PM union scoping, snapshot freeze.
- `background_sync.py` — idempotent Microsoft Graph sync (users, departments → cost centers,
  manager promotion, resource creation, CC manager assignment).
- `notifications.py` / `graph_mail.py` — notification phases and outbound email via Graph
  (see [NOTIFICATIONS.md](NOTIFICATIONS.md)).
- Reporting helpers resolve scoped resource IDs, delegated IDs, and assigned PM project IDs.

## Auth dependencies (`api/app/auth/dependencies.py`)

- `CurrentUser` carries `role` and `secondary_role`, with helpers `has_role(...)`,
  `require_role(...)`, and properties `is_reader`, `is_manager_reader`, `is_manager_pm`.
- Dependency factories: `require_roles(*roles)`, plus `require_admin`, `require_finance`,
  `require_pm`, `require_manager`.
- **Dev auth bypass:** only when `ENV=dev` **and** `DEV_AUTH_BYPASS=true`. It reads
  `X-Dev-Role`, `X-Dev-Tenant`, `X-Dev-User-Id`, `X-Dev-Email`, `X-Dev-Name`,
  `X-Dev-Secondary-Role` (empty clears the secondary role).

## Tests

```powershell
cd api
pytest                                   # full suite
pytest tests/test_planning.py            # one module
pytest tests/test_planning.py -k placeholder -v   # filtered
```

`pytest.ini` lives in `api/`; shared fixtures are in `api/tests/conftest.py`. Tests run
against an isolated in-memory/SQLite database — they do not touch your dev DB.

## Migrations

Schema changes go through **Alembic** (`api/alembic/`):

```powershell
cd api
python -m alembic upgrade head            # apply latest
python -m alembic revision -m "describe change"   # create a new revision (autogenerate where configured)
```

Run migrations against the **same database** the backend uses (match `DATABASE_URL`). For a
fresh local DB you usually don't need to run migrations manually — the dev startup seed
handles an empty database — but `upgrade head` is the safe way to bring an existing DB current.

## Config / environment

Copy `api/env.example.txt` → `api/.env`. Key variables:

- `ENV` (`dev` / `prod`), `DEV_AUTH_BYPASS` (dev only)
- `DATABASE_URL` (SQLite locally; Azure SQL in prod)
- Entra: `AZURE_TENANT_ID`, `AZURE_TENANT_ALLOWLIST`, `API_APP_CLIENT_ID`, `API_APP_ID_URI`
- Graph sync: `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`
- Notifications: `NOTIFY_MODE`, `NOTIFY_FROM_EMAIL`, schedules (see [NOTIFICATIONS.md](NOTIFICATIONS.md))
- `ADDITIONAL_CORS_ORIGINS` (extra allowed frontend origins)

## Development workflow

1. Activate the venv, set env vars, start uvicorn from the repo root.
2. Use the Dev Login panel (dev bypass) to act as any role.
3. Re-seed with `POST /dev/seed-reset` or by deleting `api/dev.db` and restarting.
4. Write/adjust tests in `api/tests/`; run `pytest` before committing.
5. Add an Alembic revision for any model change.

## Safety rules

- **Never** enable `DEV_AUTH_BYPASS` in production — it disables real auth.
- **Never** commit `DATABASE_URL`, Graph credentials, or any secret. Keep them in `api/.env`.
- Apply migrations deliberately and against the correct database.
- Keep dev/prod guards intact (dev endpoints are gated; production must use real Entra auth).
- One-off operational/diagnostic scripts have been **retired** from the repo and are not
  part of the workflow — use Alembic for schema and the API for data operations.
