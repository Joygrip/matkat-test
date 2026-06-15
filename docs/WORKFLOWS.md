# Workflows

This document describes the main end-to-end workflows. Behaviors below are verified
against the current code (`api/app/routers/` and `api/app/services/`).

## 1. Resource planning

The planning matrix (`ResourcePlanningMatrix`) shows **Demand** and **Supply** across
periods, grouped by cost center → resource → project, with computed **gaps**.

- **PM creates demand.** A demand line ties a **project** to either a **resource** *or*
  a **placeholder** (exactly one — XOR), for a period, at an FTE % (5–100, in steps of 5).
  PMs can only plan demand for their **assigned projects**.
- **Manager creates supply.** A supply line ties a **resource** to a period at an FTE %,
  optionally to a specific project (no project = general availability). Managers can only
  supply **resources in cost centers they own or that are delegated to them**.
- **Matrix shows demand, supply, and gaps.** Gap = supply − demand, color-coded
  (green ≥ 0, amber/red for shortfalls). Per-resource and per-cost-center summary rows roll up totals.
- **Placeholders** stand in for unfilled headcount. They can be created from the planning
  UI (`POST /placeholders`) and used in demand lines instead of a named resource.
- **Moving / deleting rows.** Demand and supply support group operations:
  - Group **delete** — remove all lines for a resource+project across periods.
  - Group **move** — shift/merge/copy lines across periods.
  - **Bulk** create/update/delete in one transactional call.
- **Placeholder cleanup (HARD DELETE).** After demand mutations (update, delete, group
  delete, group move), the service runs `cleanup_unused_placeholders()`, which
  **physically deletes** (`db.delete(...)`) any affected placeholder no longer referenced
  by any demand line. The deletion is recorded in the audit log with `"hard_delete": true`.
  Placeholders are not soft-deleted by this cleanup.

For Manager+PM the matrix exposes both Demand and Supply, each scoped per the rules in
[ROLES_AND_ACCESS.md](ROLES_AND_ACCESS.md): demand limited to assigned PM projects,
supply limited to owned cost-center resources.

## 2. FTE Input (own actuals)

PMs and managers record their **own** monthly actuals on the **FTE Input** page;
employees do the equivalent from the **Dashboard** (Employee view).

- A user submits actuals for **their own resource** (the resource linked to their user).
- **Ad-hoc project actuals:** the project picker offers **all active projects**, not just
  assigned ones — this supports ad-hoc work.
- `planned_fte_percent` is auto-populated from the matching supply line where available
  (project-specific first, then general supply).
- **Period constraints:** actuals can only be created in **open** periods; locked periods reject new actuals.
- **FTE constraint:** actual FTE % is 0 or 5–100 in steps of 5.
- **Signing:** creating an actual auto-signs it for the submitting user (employee, PM,
  manager, finance, admin paths each handle their own auto-sign). A signed actual is what
  enters the approval workflow.

## 3. FTE Approval

Signed actuals flow through a two-step approval chain.

- **Step 1 — Manager approval.** The approver is the resource's manager (resolved from the
  resource's user `manager_object_id`, or a manager override).
- **Step 2 — Director approval.** The approver is the cost center's `director_user_id`.
- **Proxy / delegation:**
  - A **Step 2** (director) approver can **proxy-approve Step 1**.
  - Managers can **proxy-sign** actuals on behalf of an employee
    (`POST /actuals/{id}/proxy-sign`), recording a reason.
  - Managers can **delegate** their approval authority to a colleague (Approval Delegates,
    managed from the Admin → Delegates tab).
- **Rejection / resubmit:** a rejected actual can be unsigned, edited, and re-signed
  (`DELETE /actuals/{id}/sign`, then `POST /actuals/{id}/resubmit`).
- Approval routing follows the resource→manager→director hierarchy; the chain is built per
  resource, so an approver does not action their own step where the hierarchy avoids it.

## 4. Finance

- **Cost overview** — per-cost-center demand/supply breakdown, gap analysis, and
  over-allocations for a period (`GET /consolidation/dashboard/{period_id}`).
- **Monthly FTE cost** — each period carries a `monthly_fte_cost`; consolidated cost is
  derived from FTE allocations × that rate.
- **OoP + Equipment** — out-of-pocket external lines and equipment lines are attached to
  projects per period and rolled into the cost view.
- **Snapshots / reports** — Finance can **publish a snapshot** for a period
  (`POST /consolidation/publish/{period_id}`), freezing demand, supply, approved actuals,
  OoP, equipment, and the monthly FTE cost at publish time. Snapshots are immutable and
  listed via the snapshots view.
- **Scoping:** Manager+PM cost views use a **union** scope (owned/delegated cost centers
  plus assigned PM projects); pure PM is project-scoped.

## 5. Admin

Admin (and Finance, for most master data) manages configuration:

- **Users** — read all; update role / secondary role / active status.
- **Cost centers** — CRUD, hierarchy, manager (RO) and director assignment, sync protection.
- **Projects** — CRUD and **PM assignment** (many-to-many via `ProjectPM`).
- **Periods** — create/manage periods and their open/locked status and monthly FTE cost.
- **Resources & placeholders** — CRUD (soft-delete for resources/placeholders here).
- **Graph sync** — import users/departments, refresh profiles, promote managers, create
  resources, assign cost-center managers, or run the full sequence. See [OPERATIONS.md](OPERATIONS.md).
- **Notifications** — schedules and logs. See [NOTIFICATIONS.md](NOTIFICATIONS.md).
- **Approval delegates** — Admin/Finance manage all; managers manage their own.
- **Audit logs** — browse history of master-data and planning changes.
