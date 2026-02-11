# Localhost Verification Checklist

This document provides step-by-step manual verification steps for testing the application locally using `DEV_AUTH_BYPASS=true`.

## Prerequisites

1. Backend running: `uvicorn api.app.main:app --reload` (from repo root)
2. Frontend running: `npm run dev` (from `frontend/` directory)
3. Both `.env` files configured with `DEV_AUTH_BYPASS=true`
4. Database seeded: Call `/dev/seed` endpoint once to create sample data

## Test Flow

### 1. Finance: Open/Lock Period

**Steps:**
1. Open http://localhost:5173
2. Use Dev Login Panel to login as **Finance**
3. Navigate to **Consolidation** page (or Dashboard)
4. Find the current period
5. Click **Lock Period** button
6. Enter a reason (e.g., "End of month closing")
7. Verify period status changes to "locked"
8. Verify toast shows success message

**Expected:**
- ✅ Period locks successfully
- ✅ No 403 errors
- ✅ Toast shows success message
- ✅ Period status updates in UI

### 2. PM: Add Demand Line

**Steps:**
1. Login as **PM** (via Dev Login Panel)
2. Navigate to **Demand** page
3. Verify projects/resources/placeholders load without 403 errors
4. Click **Add Demand Line** button
5. Select a project
6. Select either a resource OR placeholder (XOR enforced)
7. Enter FTE: 50 (valid: 5-100, step 5)
8. Select year/month
9. Click **Save**
10. Verify line appears in table

**Expected:**
- ✅ No 403 errors when loading projects/resources/placeholders
- ✅ XOR enforced: cannot select both resource and placeholder
- ✅ FTE validation: rejects values not in 5-100 step 5
- ✅ Placeholder blocked inside 4MFC (rolling 4 months)
- ✅ Demand line created successfully

### 3. RO: Add Supply Line

**Steps:**
1. Login as **RO** (via Dev Login Panel)
2. Navigate to **Supply** page
3. Verify resources load without 403 errors
4. Click **Add Supply Line** button
5. Select a resource
6. Enter FTE: 75
7. Select year/month
8. Click **Save**
9. Verify line appears in table

**Expected:**
- ✅ No 403 errors when loading resources
- ✅ Supply line created successfully
- ✅ FTE validation works

### 4. Employee: Enter Actuals

**Steps:**
1. Login as **Employee** (via Dev Login Panel)
2. Navigate to **Actuals** page
3. Verify projects/resources load without 403 errors
4. Click **Add Actual Line** button
5. Select a project
6. Select a resource
7. Enter FTE: 60
8. Select year/month
9. Click **Save**
10. Verify line appears
11. Try to add another line for the same resource/month with FTE: 50
12. Verify total is 110% and error shows: "Monthly total exceeds 100%"
13. Delete the second line
14. Click **Sign** button on the first line
15. Verify line shows as signed

**Expected:**
- ✅ No 403 errors when loading projects/resources
- ✅ Actual line created successfully
- ✅ >100% total blocked with precise error message
- ✅ Signing works and creates approval instance

### 5. RO: Approve Step 1

**Steps:**
1. Login as **RO** (via Dev Login Panel)
2. Navigate to **Approvals** page
3. Verify inbox shows the approval instance from step 4
4. Click on the approval instance
5. Click **Approve** button
6. Enter optional comment
7. Click **Confirm**
8. Verify approval instance shows Step 1 as approved

**Expected:**
- ✅ No 403 errors
- ✅ Inbox shows pending approvals for RO
- ✅ Approval works and moves to Step 2 (Director)

### 6. Director: Approve Step 2

**Steps:**
1. Login as **Director** (via Dev Login Panel)
2. Navigate to **Approvals** page
3. Verify inbox shows the approval instance (Step 2)
4. Click on the approval instance
5. Click **Approve** button
6. Enter optional comment
7. Click **Confirm**
8. Verify approval instance shows status as "Approved"

**Expected:**
- ✅ No 403 errors
- ✅ Inbox shows pending approvals for Director
- ✅ Approval works and finalizes the instance
- ✅ If RO==Director, Step 2 should be skipped automatically

### 7. Finance: Lock Period (Blocks Edits)

**Steps:**
1. Login as **Finance** (via Dev Login Panel)
2. Navigate to **Consolidation** page
3. Lock the current period (if not already locked)
4. Login as **PM** and try to add/edit a demand line
5. Verify error: "Period is locked. No edits allowed."
6. Login as **RO** and try to add/edit a supply line
7. Verify error: "Period is locked. No edits allowed."
8. Login as **Employee** and try to add/edit actuals
9. Verify error: "Period is locked. No edits allowed."

**Expected:**
- ✅ Locked period blocks all planning/actuals mutations
- ✅ Clear error messages shown
- ✅ No 403 errors (proper PERIOD_LOCKED error code)

## Critical Rules Verification

### XOR Constraint
- ✅ Demand line cannot have both resource and placeholder
- ✅ Demand line cannot have neither resource nor placeholder
- ✅ Error message: "DEMAND_XOR"

### 4MFC Placeholder Block
- ✅ Placeholder cannot be used inside rolling 4 months
- ✅ Placeholder allowed after 4 months
- ✅ Error message: "PLACEHOLDER_BLOCKED_4MFC"

### Actuals <=100% Enforcement
- ✅ Monthly total per resource must be <=100%
- ✅ Error shows total and offending line IDs
- ✅ Error message: "ACTUALS_OVER_100"

### Period Lock Enforcement
- ✅ Locked period blocks demand/supply/actuals mutations
- ✅ Error message: "PERIOD_LOCKED"

## Role Access Verification

### PM
- ✅ Can read projects/resources/placeholders (via `/lookups/*`)
- ✅ Can create/edit demand lines
- ✅ Cannot create/edit supply lines
- ✅ Cannot access admin CRUD endpoints

### RO
- ✅ Can read resources (via `/lookups/*`)
- ✅ Can create/edit supply lines
- ✅ Can view approvals inbox
- ✅ Can approve Step 1
- ✅ Can proxy-sign for employees

### Director
- ✅ Can view approvals inbox
- ✅ Can approve Step 2
- ✅ Can view consolidation dashboard

### Finance
- ✅ Can open/lock/unlock periods
- ✅ Can view consolidation dashboard
- ✅ Can publish snapshots
- ✅ Can read all master data
- ✅ Can create/edit/delete departments, cost centers, resources, placeholders, holidays
- ✅ Can create/edit/delete projects
- ✅ Can create/edit/delete demand lines
- ✅ Can create/edit/delete supply lines
- ✅ Cannot manage settings (Admin-only)
- ✅ Can view audit logs

### Employee
- ✅ Can read projects/resources (via `/lookups/*`)
- ✅ Can create/edit own actuals (only own resource)
- ✅ Can sign own actuals
- ✅ Cannot edit signed actuals
- ✅ Cannot create actuals for other employees' resources

### 8. Finance: Create Master Data

**Steps:**
1. Login as **Finance** (via Dev Login Panel)
2. Navigate to **Admin** page
3. Create a new Department (code: "TEST-FIN", name: "Finance Test Dept")
4. Create a new Cost Center linked to that department
5. Create a new Resource linked to the cost center
6. Create a new Placeholder
7. Create a new Holiday
8. Create a new Project (code: "FIN-TEST", name: "Finance Test Project")
9. Verify all created entities appear in their respective tabs

**Expected:**
- ✅ No 403 errors for Finance creating any master data
- ✅ All entities are created successfully
- ✅ Finance cannot access Settings tab (Admin-only)

### 9. Finance: Edit Demand/Supply Lines

**Steps:**
1. Login as **Finance** (via Dev Login Panel)
2. Navigate to **Demand** page
3. Verify "Add Demand" button is visible (not read-only)
4. Create a new demand line
5. Edit the demand line's FTE
6. Delete the demand line
7. Navigate to **Supply** page
8. Repeat: create, edit, delete a supply line

**Expected:**
- ✅ Finance can create demand/supply lines
- ✅ Finance edits still enforce XOR, 4MFC, period lock rules
- ✅ No read-only banner for Finance on planning pages

### 10. Audit Trail Verification

**Steps:**
1. Login as **Admin** or **Finance**
2. Perform some CRUD operations (create department, create project, etc.)
3. Navigate to audit log endpoint (`/audit-logs/`)
4. Verify audit entries show actions, timestamps, and user info
5. Verify audit logs are tenant-scoped (only current tenant's logs shown)

**Expected:**
- ✅ Audit trail captures CRUD operations
- ✅ Employee/PM cannot access audit logs (403)
- ✅ Audit logs properly serialize datetime values

### 11. Employee Ownership Checks

**Steps:**
1. Login as **Employee** (via Dev Login Panel)
2. Navigate to **Actuals** page
3. Create actuals for your own resource
4. Try creating actuals for another employee's resource
5. Verify 403 error with "Employees can only manage their own actuals"

**Expected:**
- ✅ Employee can only manage actuals for their own resource
- ✅ Clear error message for unauthorized resource access

## Troubleshooting

### 403 UNAUTHORIZED_ROLE
- Check that frontend is using `/lookups/*` endpoints, not `/admin/*` for read-only data
- Verify role is set correctly in Dev Login Panel
- Check backend logs for role guard failures

### "Failed to fetch"
- Verify backend is running on http://localhost:8000
- Check CORS configuration allows localhost:5173
- Verify `VITE_API_BASE_URL` in frontend `.env.local`

### Approval inbox empty
- Verify approval instance was created after signing
- Check that approver_id matches current user's id (not object_id)
- Verify cost center has ro_user_id set
- Verify director is in the same department

### Period lock not working
- Verify period status is actually "locked" in database
- Check that period lock check runs before mutations
- Verify error code is PERIOD_LOCKED (not generic 403)
