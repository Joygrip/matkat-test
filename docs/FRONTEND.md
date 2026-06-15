# Frontend

React 18 + TypeScript app under `frontend/`, bundled with Vite and styled with Fluent UI v9.

## Stack

- **React 18 + TypeScript**, **Vite** dev server / build.
- **Fluent UI v9** design system; **Recharts / D3** for charts.
- **MSAL** (`@azure/msal-browser`) for Entra authentication.

## Route / page structure (`src/App.tsx`)

Routes are defined in `App.tsx` and protected by **role-based route guards** that redirect
unauthorized roles. Navigation is rendered by `AppShell.tsx`, which also hides items by role.

| Route | Page | Access |
| --- | --- | --- |
| `/` | `Dashboard` | All roles (renders a role-specific view) |
| `/resource-planning` | `ResourcePlanning` | Admin, Finance, PM, Manager (guard excludes Employee) |
| `/fte-input` | `FteInput` | PM, Manager (own actuals) |
| `/actuals` | `Actuals` (labeled **FTE Approval**) | Admin, Finance, Manager (Employees redirected to `/`) |
| `/finance` | `Finance` | Admin, Finance, Manager, PM (Manager+Reader gets read-only nav) |
| `/admin` | `Admin` | Admin, Finance (Managers can reach the Delegates tab) |
| `/audit-logs` | `AuditLogs` | Admin, Finance |
| `/demand`, `/supply` | redirect → `/resource-planning` | — |
| `/finance-dashboard`, `/consolidation` | redirect → `/finance` | — |

**Employees** have no Resource Planning, FTE Input, or FTE Approval access — they record
actuals from the Employee view on the Dashboard.

## AppShell / navigation

`AppShell.tsx` renders the nav and computes visible items from the current role and
secondary-role flags. Hiding nav items is a UX convenience only — see "Route guards" below.

## Auth (`src/auth/`)

- `AuthProvider.tsx` initializes MSAL (`PublicClientApplication`), acquires tokens (silent
  with popup fallback), and fetches identity via `/me`.
- In dev (`VITE_DEV_AUTH_BYPASS=true`) it sends `X-Dev-*` headers instead of tokens, enabling
  the Dev Login panel.
- Hooks: `useAuth()`, `useHasRole(...)`, `useIsManagerReader()`, `useIsManagerPM()`,
  `useCanPM()`. Capability flags come from the `/me` response.

## API clients (`src/api/`)

All clients wrap a shared `ApiClient` (token/dev-header injection, error normalization):

- `client.ts` — base HTTP client.
- `planning.ts` — demand/supply line operations.
- `actuals.ts` — actuals + approval operations, own resource lookup.
- `admin.ts` — master data CRUD, approval delegates.
- `lookups.ts` — resources/projects/cost-centers/placeholders (scoped and unscoped variants).
- `periods.ts` — periods + lock/unlock.
- `finance.ts`, `consolidation.ts` — cost overview and snapshots.
- `projectCosts.ts` — OoP + equipment lines.

## Contexts (`src/contexts/`)

- **AppDataContext** — `costCenters`, `projects`, the user's own `myResource`, a loading
  flag, and `refreshAppData()`. Project lists are loaded **scoped per role** (PM and
  Finance/Admin use scoped project lists; Resource Planning fetches its own scoped list).
- **PeriodContext** — `periods`, `selectedPeriodId` / `setSelectedPeriodId`,
  `selectedPeriod`, loading, and `refreshPeriods()`. Defaults to the earliest open period;
  gated on a signed-in user to avoid 401s during token refresh.

## Key components

- **`ResourcePlanningMatrix.tsx`** — the planning grid. Shows Demand and Supply across
  periods, grouped by cost center → resource → project, with computed gaps and placeholder
  rows. Supports cell editing, drag-select, group move/delete, and add-line dialogs. Props
  (`canEditDemand`, `canEditSupply`, `canPM`, `editableCcIds`) drive what each role can edit;
  the backend independently enforces scope.
- **Dashboard components (`src/components/dashboard/`)** — one view per role, selected in
  `Dashboard.tsx`:
  - `EmployeeView` (own actuals), `PMDashboard`, `ManagerDashboard`, `ManagerPMDashboard`
    (dual manager + PM sections), `ReaderView` (Manager+Reader, read-only incl. finance),
    `FinanceDashboard`, `AdminView`.
- **Finance components** — `ConsolidatedCostChart` (cost overview) and `ProjectCostsMatrix`
  (OoP + equipment), surfaced via the Finance page tabs.
- **Actuals/FTE components** — `MyActualsMatrix` (own actuals entry for employees and FTE
  Input) and `ActualsTab` (approval workflows).

## Role-based UI patterns

- The **Dashboard** picks a view component from the user's role + secondary-role flags.
- Nav items and in-page actions are shown/disabled by role; read-only roles see disabled
  controls and banners rather than write actions.
- Scoped vs. unscoped lookup calls (`listProjectsScoped()` vs `listProjects()`) ensure PMs
  see only assigned projects where appropriate.

## Route guards

Guards in `App.tsx` (e.g. `ResourcePlanningRoute`, `ActualsRoute`, `FteInputRoute`)
redirect unauthorized roles to `/`. **These are UX only** — they do not grant or deny data
access. The backend enforces all role and object-level authorization.

## Build / test commands

```powershell
cd frontend
npm install
npm run dev            # Vite dev server (proxies /api to the backend)
npx tsc --noEmit       # type-check only
npm run build          # tsc + vite build
npm run test           # vitest
npm run lint           # eslint
```
