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

---
Add further changes and fixes below as needed.
