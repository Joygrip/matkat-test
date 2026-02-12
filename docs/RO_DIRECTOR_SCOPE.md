# RO and Director Scope: See Only Their Employees

## Goal (finished product)

RO and Director should see only data for **their** employees (direct reports / org subtree). This will be implemented later using **Microsoft Graph** for organization and reporting structure, and tied into the app’s User and Resource model.

## Current state

- RO and Director can see **all** demand, supply, actuals, and approvals within the tenant.
- There is no filtering by reporting line or cost center for these roles.
- The data model already supports:
  - **User.**`manager_object_id` (e.g. employee → RO, RO → Director).
  - **CostCenter.**`ro_user_id` (RO responsible for a cost center).
  - **User.**`department_id` / `cost_center_id` for Directors.

## Scope definition (target)

- **RO:** See only users/resources in cost centers they own (using `CostCenter.ro_user_id`), or—if we move to a pure org-based model—only direct (and optionally indirect) reports.
- **Director:** See only their department or org subtree (e.g. direct and indirect reports).

## Intended use of MS Graph

1. Use Microsoft Graph to read organization and reporting structure (e.g. `/me/directReports`, manager chain, or org hierarchy).
2. Map Graph users to app **User** (e.g. by Entra `object_id`) and optionally sync `manager_object_id` and department/cost center.
3. Cache or store a “reporting chain” or “visible user IDs” per RO/Director so we can filter without calling Graph on every request.

## Backend (when implemented)

- For list endpoints used by RO/Director (demand lines, supply lines, actuals, approvals, resources list), add a **scope layer**:
  - Resolve the current user’s “visible” user IDs or resource IDs (from manager/reports and/or cost center).
  - Filter queries accordingly (e.g. demand/supply/actuals by `resource_id` in visible set; approvals by assignee in visible set).

## Frontend

- No change until the backend exposes scoped data.
- Once backend applies scope, RO and Director will simply see fewer rows in existing tables and lists.

## Summary

| Area        | Action (future)                                                |
|------------|-----------------------------------------------------------------|
| Data model | Already has `User.manager_object_id`, `CostCenter.ro_user_id`. |
| MS Graph   | Sync org/reporting structure; fill manager and scope data.     |
| Backend    | Add scope resolution and filter list endpoints for RO/Director. |
| Frontend   | Use existing UI; no changes once backend scopes data.            |
