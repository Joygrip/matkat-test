# Changes Log

## 2026-02-10: Year and Month Validation Fixes

### Problem
- Creating demand or supply lines failed with a 400 Bad Request error due to missing required fields: `year` and `month`.
- The frontend was not sending `year` and `month` in the payload when creating demand or supply lines, causing backend validation errors.

### Solution
- Updated the demand line creation logic in `frontend/src/pages/Demand.tsx` to:
  - Ensure a valid period is selected before creating a demand line.
  - Always include `year` and `month` from the selected period in the payload sent to the backend.
- Updated the supply line creation logic in `frontend/src/pages/Supply.tsx` to:
  - Ensure a valid period is selected before creating a supply line.
  - Always include `year` and `month` from the selected period in the payload sent to the backend.

### Result
- Demand and supply line creation now works as expected, with all required fields sent to the backend and no more validation errors for missing `year` or `month`.

## 2026-02-10: Dashboard Bar Chart Filtering by Project and Resource

### Problem
- Users could not filter the dashboard bar charts by project or resource. The charts always showed aggregate data for all projects/resources.

### Solution
- Added project and resource dropdown filters to the dashboard UI (`frontend/src/pages/Dashboard.tsx`).
- Fetched the list of projects and resources for the filter controls.
- Updated chart data loading logic to use the selected project and resource as filters.
- Updated API calls to pass `project_id` and `resource_id` as query parameters when fetching demand and supply lines.
- The bar chart now reflects the user's selected project and/or resource.

### Result
- Users can now filter the dashboard bar charts by project and/or resource, and see supply/demand for their selection.

## 2026-02-10: Dashboard Filtering Bugfixes

### Problem
- Dashboard bar charts did not update when filtering by project or resource; the same data was shown regardless of filter selection.
- Backend endpoints did not support filtering by `project_id` or `resource_id`.

### Solution
- Updated backend `/demand-lines` and `/supply-lines` endpoints to accept `project_id` and `resource_id` as query parameters and filter results accordingly (`api/app/routers/planning.py`).
- Updated service layer methods to support these filters (`api/app/services/planning.py`).
- Fixed frontend to always pass selected filters as query parameters when loading chart data.

### Result
- Dashboard bar charts now correctly reflect the selected project and/or resource filters.
- Users can analyze supply and demand for specific projects and resources as intended.

## 2026-02-10: Finance Dashboard for Employee Actuals

### Problem
- Finance users needed a dashboard to view all employee actuals, sortable and filterable by project, cost center, period, and approval status.
- Approval status and current approval step were not visible in a single view for Finance.
- Initial implementation had CORS, role, and data validation issues.

### Solution
- Added a new backend endpoint `/finance/actuals-dashboard` (FastAPI, `api/app/routers/finance.py`) for Finance users.
  - Returns all employee actuals with project, cost center, FTE, period, approval status, and current approval step/approver.
  - Supports filtering by year, month, project, cost center, and approval status.
- Created a new frontend page `FinanceDashboard.tsx`:
  - Displays a table of actuals with columns for employee, project, cost center, FTE, period, approval status, and current approval step/approver.
  - Added dropdown filters for year, month, project, cost center, and approval status.
  - Implemented sorting by clicking table headers.
  - Added loading and empty state messages for better UX.
- Fixed CORS and 403 errors by ensuring correct role selection and headers in dev mode.
- Fixed backend validation error for missing/nullable employee emails.
- Fixed frontend to use the API client for correct base URL and headers.

### Result
- Finance users can now view, filter, and sort all employee actuals in a dedicated dashboard.
- Approval status and workflow step are visible for each actual.
- Dashboard is robust to missing data and works with dev auth bypass.

## 2026-02-11: Finance Expanded Permissions (Phase 4)

### Problem
- Finance users could not create, update, or delete master data (departments, cost centers, resources, placeholders, holidays) or planning lines (demand, supply).
- PM/RO/Employee should remain restricted from master data write actions.
- Finance permissions list and frontend UI did not reflect new access.

### Solution
- Updated `api/app/routers/admin.py`:
  - Added `MASTER_DATA_WRITE_ROLES = (UserRole.ADMIN, UserRole.FINANCE)`.
  - All POST/PATCH/DELETE endpoints for departments, cost centers, resources, placeholders, holidays now allow Admin and Finance.
  - Updated docstrings to reflect Finance access.
- Updated `api/app/routers/planning.py`:
  - Finance can now create, update, and delete demand and supply lines (POST/PATCH/DELETE endpoints for both).
  - Updated docstrings to reflect Finance access.
- Updated frontend `Admin.tsx`:
  - Finance can now create, edit, and delete all master data types in the UI.
  - All master data tabs and actions are visible and enabled for Finance.
- Updated backend and frontend tests:
  - Finance can manage all master data and planning lines.
  - PM/RO/Employee are still forbidden from master data write actions (403).
- No changes to Settings endpoints: only Admin can manage Settings.
- Documented all changes in this file.

### Result
- Finance can now fully manage all master data and planning lines, both via API and UI.
- PM/RO/Employee permissions are unchanged.
- All changes are tenant-scoped and business rules (XOR, 4MFC, period lock) are still enforced.

## 2026-02-11: Phase 5 - Audit Logging for Departments

### Problem
- No audit trail for changes to master data (departments), making compliance and troubleshooting difficult.

### Solution
- Added `AuditLog` model and Alembic migration for `audit_logs` table.
- Created audit logging service and `/audit-logs` API endpoint (Admin/Finance only).
- Integrated audit logging with department create, update, and delete endpoints in `admin.py`.
- Each change logs user, action, entity, entity_id, before/after state, and more.

### Result
- All department changes are now tracked in the audit log and can be reviewed by Admin/Finance via the API.
- Provides a foundation for expanding audit logging to other master data and planning endpoints.

## 2026-02-11: Phase 5 - Bulk Edit for Demand Lines

### Problem
- Users (Finance/PM) needed to efficiently update multiple demand lines at once, but could only edit one at a time.
- No bulk edit UI or API usage for demand lines.

### Solution
- Added a bulk edit dialog to the Demand Planning page (frontend):
  - Multi-select demand lines and click "Edit Selected" in the toolbar.
  - Dialog allows updating FTE %, project, resource/placeholder for all selected lines.
  - Only changed fields are sent to the backend; fields left blank are not updated.
  - Only users with PM or Finance roles can perform bulk edit.
- Wired up to the `/demand-lines/bulk` backend endpoint, which enforces role checks and business rules.
- On success, demand lines reload and selection is cleared.

### Result
- Finance and PM users can now efficiently update multiple demand lines in one action.
- Bulk edit is not available to Admin, RO, or Employee roles.
- All changes are tenant-scoped and business rules (XOR, 4MFC, period lock) are still enforced.

## 2026-02-11: Phase 5 - Role-Based UI Restrictions for Bulk Actions

### Problem
- PMs could see and attempt bulk/multi-select actions on Supply, and ROs could see and attempt bulk/multi-select actions on Demand, even though these actions are forbidden by business rules.
- This caused confusion and unnecessary UI elements for users without permission.

### Solution
- Updated frontend logic on Demand and Supply pages:
  - Bulk toolbars, dialogs, and checkboxes for multi-select are now only visible to roles with edit permission (Finance + PM for Demand, Finance + RO for Supply).
  - Forbidden roles (PM on Supply, RO on Demand) no longer see checkboxes or bulk action toolbars.
  - All add, delete, and bulk edit actions are fully hidden for forbidden roles.
- This ensures the UI matches backend role enforcement and improves user experience.

### Result
- Only users with edit permission see and can use bulk/multi-select actions.
- Forbidden roles see a clean, read-only view with no unnecessary controls.
- UI and backend are now fully consistent for role-based access to planning line bulk operations.

---
Add further changes and fixes below as needed.
