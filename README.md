# MatKat 2.0

MatKat is a multi-tenant **resource allocation and planning** application. Project
managers plan **demand** (who is needed on which project), managers plan **supply**
(who is available from their cost centers), and the system surfaces the **gaps**
between them across monthly periods. Employees, PMs, and managers record their own
monthly **actuals** (FTE %), which flow through an **approval** workflow. Finance
gets a consolidated **cost overview** (monthly FTE cost, out-of-pocket and equipment
costs, immutable snapshots), and Admin/Finance manage all **configuration** — cost
centers, projects, PM assignments, periods, resources, placeholders, Microsoft Graph
sync, notifications, and audit logs.

---

## Current stack

| Layer | Technology |
|---|---|
| **Backend** | FastAPI (Python 3.11+), SQLAlchemy 2.x, Alembic migrations |
| **Frontend** | React 18 + TypeScript, Vite, Fluent UI v9, Recharts/D3 |
| **Database** | SQLite (local dev) / Azure SQL (production) |
| **Auth** | Microsoft Entra ID via MSAL (frontend) + JWT validation (backend); dev auth bypass for local work |
| **Hosting** | Azure App Service / containers (API) + Azure Static Web Apps (frontend) |
| **Graph / email** | Microsoft Graph for user/department/manager sync and for outbound email notifications |
| **Scheduler** | Azure Functions timer project (`scheduler/`) that triggers notification phases |

---

## Main app areas

- **Dashboard** — role-specific landing view (per-role dashboards and own-actuals entry).
- **Resource Planning** — demand/supply matrix with gaps and placeholders.
- **FTE Input** — PMs and managers record their *own* monthly actuals.
- **FTE Approval** — managers/finance/admin review, approve, reject, and proxy-sign actuals.
- **Finance** — consolidated cost overview, out-of-pocket + equipment costs, snapshots.
- **Admin** — master data, PM assignments, periods, Graph sync, notifications.
- **Audit Logs** — searchable history of master data and planning changes.

---

## Role summary

| Role | What they do |
|---|---|
| **Employee** | Enter and sign their own monthly actuals (via the Dashboard). No planning access. |
| **PM** | Plan demand and OoP/equipment for their **assigned projects**; record own actuals. |
| **Manager** | Plan supply for their **cost-center (and delegated) resources**; approve actuals; record own actuals. |
| **Finance** | Read-all + consolidated cost overview, period management, publish snapshots, master data. |
| **Admin** | Full configuration and master-data management; Graph sync; notifications; audit logs. |
| **Reader** | Read-only visibility (used today as a secondary role). |
| **Manager+PM** | Additive: manager supply scope **and** PM demand scope (see details below). |
| **Manager+Reader** | Manager with broad read-only visibility, including Finance views. |

See **[docs/ROLES_AND_ACCESS.md](docs/ROLES_AND_ACCESS.md)** for the full access matrix and scoping rules.

---

## Local setup

> Use `<repo-root>` to mean the directory where this repository is checked out.
> Commands below are PowerShell-first (this repo is most often used on Windows); a
> Bash equivalent follows where syntax differs.

**Prerequisites:** Python 3.11+, Node.js 18+, Git.

### Backend (PowerShell)

```powershell
# From <repo-root>
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r api/requirements-dev.txt

# Configure environment (see "Environment files" below)
Copy-Item api/env.example.txt api/.env
# Edit api/.env: ENV=dev, DEV_AUTH_BYPASS=true, DATABASE_URL=sqlite:///./api/dev.db

# Run migrations if needed (a fresh dev DB is auto-created and seeded on first start)
cd api
python -m alembic upgrade head
cd ..

# Start the backend from the repo root so `api.app.main` imports resolve
$env:PYTHONPATH = (Get-Location).Path
uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
```

Bash equivalent for the env/start steps:

```bash
cp api/env.example.txt api/.env
export PYTHONPATH="$(pwd)"
uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (PowerShell)

```powershell
cd frontend
npm install
Copy-Item env.example.txt .env.local
# Edit .env.local: VITE_DEV_AUTH_BYPASS=true
# Leave VITE_API_BASE_URL unset so the Vite dev proxy is used (avoids CORS)
npm run dev
```

### Start both (Windows helper script)

```powershell
# Opens backend and frontend in separate PowerShell windows
.\scripts\start-all.ps1
```

(`scripts/start-backend.ps1` and `scripts/start-frontend.ps1` start each service individually.)

URLs once running:

- Frontend: <http://localhost:5173>
- API: <http://localhost:8000>
- API docs (Swagger): <http://localhost:8000/docs>
- Health check: <http://localhost:8000/healthz>

In dev (`DEV_AUTH_BYPASS=true`), use the **Dev Login** panel to switch role / tenant
instantly — no Entra sign-in required. On first startup with an empty database, the
backend auto-seeds full example data; you can also call `POST /dev/seed-reset` to wipe
and re-seed.

---

## Environment files

- Backend: copy **[api/env.example.txt](api/env.example.txt)** → `api/.env`.
- Frontend: copy **[frontend/env.example.txt](frontend/env.example.txt)** → `frontend/.env.local`.

The example files document every variable. **Never commit real secrets** (Entra
client secrets, connection strings, deployment tokens) — keep them only in your local
`.env` / `.env.local` (both git-ignored).

---

## Tests and build

```powershell
# Backend tests (run from api/)
cd api
pytest

# Targeted examples
pytest tests/test_planning.py
pytest tests/test_planning.py -k placeholder -v

# Frontend type-check + build (run from frontend/)
cd ../frontend
npx tsc --noEmit
npm run build
npm run test     # vitest
```

---

## Documentation

| Doc | Contents |
|---|---|
| [docs/APP_OVERVIEW.md](docs/APP_OVERVIEW.md) | What MatKat solves, modules, terminology, data sources |
| [docs/ROLES_AND_ACCESS.md](docs/ROLES_AND_ACCESS.md) | Roles, secondary roles, access matrix, scoping rules |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md) | Planning, FTE input, approval, finance, admin workflows |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Repo layout, backend/frontend architecture, auth/data flow |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Core models and relationships |
| [docs/BACKEND.md](docs/BACKEND.md) | Backend startup, routers, services, migrations, config |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Frontend routes, contexts, components, route guards |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Local run, tests, migrations, Graph sync, troubleshooting |
| [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) | Email notifications, Graph mail, scheduler |

---

## Safety notes

- **Do not commit secrets** — Entra client secrets, `DATABASE_URL` connection
  strings, Graph credentials, and deployment tokens stay in local env files only.
- **Do not commit local DBs/backups** — `api/dev.db` and similar are dev-only and
  disposable (delete and restart to re-seed).
- **Dev auth bypass is dev-only** — `DEV_AUTH_BYPASS` must never be enabled in
  production. The backend gates dev endpoints behind it.
- Retired one-off scripts (CSV importers, ad-hoc migrations, diagnostics) are **not**
  part of the active workflow and have been removed from the repository. Use Alembic
  for schema changes and the application's own endpoints for data operations.

---

## License

Proprietary — internal use only.
