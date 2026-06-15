# MatKat — Application Overview

## What problem MatKat solves

Organizations need to know, per month and per project, **who is needed** (demand),
**who is available** (supply), and **where the gaps are** — and then reconcile that
plan against **what actually happened** (actuals) and **what it cost** (finance).
MatKat brings these together in one multi-tenant system so that:

- **Project managers** declare the resources/effort a project needs.
- **Managers** declare which of their cost-center resources are available and to which projects.
- Everyone sees the **demand-vs-supply gap** per cost center, resource, and project.
- **Employees, PMs, and managers** record their **actual** monthly effort (FTE %).
- Actuals go through an **approval** chain (manager → director).
- **Finance** consolidates monthly FTE cost, out-of-pocket and equipment costs, and publishes immutable **snapshots**.
- **Admins** configure everything and keep org data in sync with Microsoft Entra/Graph.

## High-level modules

| Module | Purpose |
| --- | --- |
| **Dashboard** | Role-specific landing page; for employees it is also where they enter actuals. |
| **Resource Planning** | The demand/supply matrix — create, move, and delete demand and supply lines; see gaps and placeholders. |
| **FTE Input** | Where PMs and managers submit their *own* monthly actuals (ad-hoc and project work). |
| **FTE Approval** | Where managers/finance/admin review, approve, reject, and proxy-sign actuals. |
| **Finance** | Consolidated cost overview, out-of-pocket + equipment costs, and snapshot publishing. |
| **Admin** | Master data (cost centers, projects, resources, placeholders), PM assignment, periods, Graph sync, notifications. |
| **Audit Logs** | History of master-data and planning changes with before/after values. |

## How the pieces fit together

```
Microsoft Graph (Entra)
   │  users, departments, manager chains
   ▼
Cost centers / Users / Resources  ──┐
                                    │ (manual config: projects, PM assignment, periods, placeholders)
                                    ▼
        Resource Planning:  Demand (PM) ── vs ── Supply (Manager)  →  Gaps
                                    │
                                    ▼
              Actuals (Employee / PM / Manager own FTE %)
                                    │
                                    ▼
                Approval (Manager → Director)
                                    │
                                    ▼
        Finance: monthly FTE cost + OoP/equipment  →  Snapshots (immutable)
```

1. **Org data** (users, cost centers, manager hierarchy) is synced from Microsoft Graph.
2. **Projects, PM assignments, periods, resources, and placeholders** are configured by Admin/Finance.
3. **PMs plan demand** against their assigned projects; **managers plan supply** for their cost-center resources.
4. The planning **matrix** computes gaps (supply − demand) and shows placeholders for unfilled headcount.
5. **Actuals** are recorded per resource/project/month and **signed**.
6. Signed actuals run through the **approval** workflow.
7. **Finance** consolidates costs and can **publish a snapshot** that freezes the period's numbers.

## Terminology

| Term | Meaning |
| --- | --- |
| **Resource** | A person (employee/external/student) or out-of-pocket line that can be planned and that records actuals. Linked to a cost center; optionally linked to a User. |
| **Cost center** | Organizational unit owning resources. Has an owning manager (Resource Owner) and a director. Often mirrors a Graph department. |
| **Project** | A unit of work that demand is planned against. Has one or more assigned PMs (many-to-many). |
| **Period** | A single month (year + month). Has a status — **open** or **locked** — and a monthly FTE cost used for finance. |
| **Demand** | A line stating that a project needs a given resource *or* a placeholder at an FTE % for a period. |
| **Supply** | A line stating that a resource is available (optionally to a specific project) at an FTE % for a period. |
| **Actuals** | The recorded *actual* monthly effort (FTE %) of a resource on a project, signed and then approved. |
| **Placeholder** | A stand-in for unfilled/future headcount in a cost center, usable in demand instead of a named resource. Created from planning and cleaned up automatically when no longer referenced. |
| **OoP / Equipment** | Out-of-pocket external costs and equipment costs attached to a project for a period (project cost lines). |
| **Snapshot / reporting** | An immutable, published copy of a period's demand, supply, approved actuals, and costs for finance reporting. |
| **Gap** | Supply minus demand for a given slice (resource/cost center/project), color-coded in the matrix. |

## What comes from Graph sync

Microsoft Graph is the **source of truth** for organizational data:

- **Users** — identity, display name, email, active/inactive state.
- **Departments** — imported as cost centers (a department rename creates a new cost center; the old one is soft-deleted).
- **Manager chains** — used to drive approval routing and manager promotion.
- **Resources** — `Resource` rows are created for active users during sync.
- **Cost-center managers/directors** — auto-assigned where not already set.

Graph sync is **idempotent** and designed to run repeatedly without creating
duplicates. See [OPERATIONS.md](OPERATIONS.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## What is configured manually

These are managed in **Admin** (or by Finance where allowed), not synced from Graph:

- **Projects** and their **PM assignments**.
- **Periods** and their open/locked status and monthly FTE cost.
- **Placeholders** (also created on the fly from Resource Planning).
- **Holidays** and global **settings**.
- **Notification schedules**.
- **Approval delegates** (a manager delegating their approval authority).
