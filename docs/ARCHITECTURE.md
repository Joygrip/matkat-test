# Architecture

## Repository structure

```
<repo-root>/
├── api/                      # FastAPI backend
│   ├── app/
│   │   ├── main.py           # App factory, router registration, CORS, startup seed
│   │   ├── models/           # SQLAlchemy models (core, planning, actuals, approvals, …)
│   │   ├── routers/          # HTTP endpoints (planning, actuals, consolidation, admin, …)
│   │   ├── services/         # Business logic (planning, actuals, consolidation, sync, notifications)
│   │   ├── schemas/          # Pydantic request/response models
│   │   └── auth/             # Auth dependencies, CurrentUser, dev bypass
│   ├── alembic/              # Database migrations
│   ├── tests/                # pytest suite (+ conftest.py)
│   ├── pytest.ini
│   └── requirements*.txt
├── frontend/                 # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx           # Routes + route guards
│   │   ├── AppShell.tsx      # Navigation shell
│   │   ├── pages/            # Page components
│   │   ├── components/       # Reusable + dashboard + matrix components
│   │   ├── api/              # Typed API clients
│   │   ├── contexts/         # AppDataContext, PeriodContext
│   │   └── auth/             # AuthProvider (MSAL), msalConfig
│   └── public/               # Static assets (logo)
├── scheduler/                # Azure Functions timer project (notification triggers)
├── scripts/                  # PowerShell dev start scripts
└── docs/                     # This documentation
```

## Backend architecture

- **FastAPI** app assembled in `api/app/main.py`: routers are registered, CORS is
  configured (localhost dev origins plus `ADDITIONAL_CORS_ORIGINS`), and on startup in dev
  the database is auto-seeded if empty.
- **Layering:** `routers/` handle HTTP and auth gating; `services/` hold business logic and
  scoping; `models/` are SQLAlchemy ORM classes; `schemas/` are Pydantic models for I/O.
- **Errors** use Problem Details-style responses with stable error codes
  (e.g. `FTE_INVALID`, `PERIOD_LOCKED`, `UNAUTHORIZED_ROLE`).
- **Persistence:** SQLAlchemy 2.x against SQLite (dev) or Azure SQL (prod). Schema changes
  go through **Alembic** migrations.

## Frontend architecture

- **React 18 + TypeScript**, bundled by **Vite**, styled with **Fluent UI v9**; charts use
  Recharts/D3.
- **Routing** is centralized in `App.tsx` with role-based **route guards**
  (e.g. `ResourcePlanningRoute`, `ActualsRoute`, `FteInputRoute`) that redirect unauthorized roles.
- **AppShell.tsx** renders the nav; items are shown/hidden by role (UI convenience only — see below).
- **Contexts** provide shared state:
  - `AppDataContext` — cost centers, projects, the user's own resource, and a refresh hook.
    Project lists are loaded scoped per role (PM/Finance/Admin use scoped project lists).
  - `PeriodContext` — all periods and the currently selected period (defaults to the
    earliest open period).
- **API clients** in `src/api/` wrap a shared `ApiClient` (token injection for MSAL, dev
  headers for bypass, error normalization).

## API / client flow

```
React page/component
   └── src/api/<client>.ts  (typed wrapper)
          └── ApiClient.get/post/patch/delete
                 ├── attaches Authorization: Bearer <token>  (MSAL)        [prod]
                 └── attaches X-Dev-Role / X-Dev-Tenant / …                 [dev bypass]
                        └── FastAPI router → auth dependency → service → DB
```

In dev, the Vite dev server **proxies** `/api` to `http://localhost:8000`, so the browser
talks same-origin and CORS is avoided (leave `VITE_API_BASE_URL` unset).

## Auth flow

- **Production:** the frontend uses **MSAL** (`@azure/msal-browser`) to sign the user in
  against Microsoft Entra and acquire an access token (silent with popup fallback). The
  token is sent as a Bearer header; the backend validates it and resolves the
  `CurrentUser` (role + secondary role from Entra app roles).
- **Development:** with `DEV_AUTH_BYPASS=true` and `ENV=dev`, the backend trusts `X-Dev-*`
  headers, letting the Dev Login panel switch role/tenant instantly. This path is disabled
  unless both flags are set.
- The frontend reads identity and capability flags from `GET /me`
  (`is_manager_pm`, `is_manager_reader`, `can_pm`, `can_manage`, `permissions`).

## Data flow

| Stage | Source → Target |
| --- | --- |
| **Org sync** | Microsoft Graph → Users, Cost centers (from departments), Resources, manager/director assignment |
| **Planning** | PM → Demand lines; Manager → Supply lines; matrix computes gaps |
| **Actuals** | Employee/PM/Manager → Actual lines → signed |
| **Approval** | Signed actuals → ApprovalInstance/ApprovalStep (Manager → Director) |
| **Finance** | Approved actuals + demand/supply + OoP/equipment + monthly FTE cost → consolidated costs → published snapshots |

## Caching / context

- Frontend caches lookup data in `AppDataContext` and period state in `PeriodContext` to
  avoid refetching on every page; both expose explicit refresh functions.
- Backend scoping (cost-center resource IDs, delegated IDs, assigned PM project IDs) is
  resolved per request inside the reporting/planning services.

## Background tasks / scheduler

- Email notifications are driven by **notification schedules** (`NotificationSchedule`) and
  executed by the notifications service.
- The **`scheduler/`** Azure Functions timer project triggers notification phases on a
  cadence and calls the API. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Deployment (high level)

- **API** runs on Azure App Service / containers; **frontend** is deployed as an Azure
  Static Web App; the **database** is Azure SQL.
- Environment configuration (Entra IDs, database URL, Graph credentials, notification mode)
  is supplied via app settings — never committed to the repo.
- Schema changes are applied with Alembic. Detailed deployment runbooks are out of scope
  for this repo's docs; keep secrets and deployment tokens out of version control.
