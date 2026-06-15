# Roles and Access

MatKat uses Microsoft Entra **app roles** mapped to the `UserRole` enum, plus an
optional **secondary role** string for additive/combined behaviors.

## Primary roles

The backend `UserRole` enum (`api/app/models/core.py`) has exactly these members:

| Role | Enum value | Summary |
| --- | --- | --- |
| **Admin** | `Admin` | Full configuration and master-data access; Graph sync; notifications; audit logs. |
| **Finance** | `Finance` | Read-all; consolidated cost overview; period management; publish snapshots; master data. |
| **PM** | `PM` | Plan demand and OoP/equipment for **assigned projects**; record own actuals via FTE Input. |
| **Manager** | `Manager` | Plan supply for **cost-center (and delegated) resources**; approve actuals; record own actuals. |
| **Employee** | `Employee` | Record and sign **own** actuals from the Dashboard. No planning access. |
| **Reader** | `Reader` | Read-only role. In current usage it appears primarily as a **secondary** role (Manager+Reader). |

## Secondary roles

A user's `secondary_role` field (a string) combines with their primary role. The two
combinations the app implements today:

- **Manager+PM** — `role = Manager`, `secondary_role = "PM"`. Backend helper `is_manager_pm`.
- **Manager+Reader** — `role = Manager`, `secondary_role = "Reader"`. Backend helper `is_manager_reader`.

These are exposed to the frontend via the `/me` response flags `is_manager_pm`,
`is_manager_reader`, `can_pm`, and `can_manage`.

## Access matrix

✓ = full access · RO = read-only · ✗ = no access · *(note)* = see scoping rules below.

| Area | Employee | PM | Manager | Manager+PM | Manager+Reader | Finance | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | ✓ (own actuals) | ✓ | ✓ | ✓ | ✓ (read) | ✓ | ✓ |
| Resource Planning | ✗ | ✓ demand* | ✓ supply* | ✓ demand+supply* | ✗ | RO | ✓ |
| FTE Input (own actuals) | ✗ (uses Dashboard) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| FTE Approval | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Finance Cost Overview | ✗ | ✓ project-scoped* | ✓ | ✓ union-scoped* | ✓ (read) | ✓ | ✓ |
| OoP + Equipment | ✗ | ✓ project-scoped* | ✓ | ✓ | RO | ✓ | ✓ |
| Admin | ✗ | ✗ | Delegates tab only | Delegates tab only | ✗ | ✓ | ✓ |
| Audit Logs | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Notifications / config | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (read logs) | ✓ |
| Graph sync | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

Notes:
- **Employees** record actuals from the **Dashboard** (Employee view); the dedicated
  FTE Input and FTE Approval pages are not available to them.
- **Managers** can reach the Admin page's **Delegates** tab to manage their own
  approval delegation, but not the rest of Admin.
- **Manager+Reader** gets read-only Finance navigation in addition to standard manager visibility.

## Scoping rules

These are enforced by the backend (frontend navigation is convenience only):

- **Employees cannot access Resource Planning** at all (route guard + nav both exclude them).
- **PM demand / OoP / equipment is assigned-project scoped.** A PM may only plan
  demand and edit project costs for projects they are assigned to (via the
  many-to-many `ProjectPM` association). The backend raises 403 for unassigned projects.
- **FTE Input own actuals can use all active projects.** The project picker in FTE
  Input (and the actuals flow generally) is **not** restricted to assigned projects —
  this supports ad-hoc work. Self-scoping is to the user's own resource, not to projects.
- **Manager supply is manager/delegated cost-center scoped.** A manager may plan
  supply only for resources in cost centers they own — plus any cost centers
  **delegated** to them. Out-of-scope resources are rejected (403).
- **Manager+PM is additive:**
  - **Demand:** all cost centers and resources are visible for demand, but only the
    manager's **assigned PM projects** may be planned against.
  - **Supply:** only the manager's **own cost-center resources** may be supplied, but
    against **all projects**.
  - **Finance / cost views:** a **union** scope — the manager's cost centers (including
    delegated) plus their assigned PM projects across all cost centers.
- **Manager+Reader** has broad **read** visibility (including Finance views) but writes
  remain bounded by normal manager rules.
- **Finance and Admin** have broad access; Admin additionally owns Graph sync and
  notification configuration.

## Backend enforcement

Front-end route guards and hidden nav items are **not security** — they only shape the
UI. Authorization is enforced server-side:

- `CurrentUser.require_role(...)` / `require_roles(...)` factories gate endpoints by role
  (`api/app/auth/dependencies.py`).
- Helpers `is_manager_pm`, `is_manager_reader`, `is_reader`, `has_role(...)` drive
  combined-role logic.
- Object-level scoping (assigned PM projects, owned/delegated cost-center resources) is
  checked inside the planning, actuals, project-costs, and consolidation services before
  any read or write is allowed.
- In dev, `DEV_AUTH_BYPASS=true` lets you impersonate any role/tenant via `X-Dev-*`
  headers; this is gated to `ENV=dev` and must never be enabled in production.
