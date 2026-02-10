# MatKat 2.0 - Core Fixes & UI Modernization TODO

## Phase 0 — Create Plan + Reproduce Issues ✅

### New Bug Reports Identified

**1. Actuals Flow Broken:** ✅ FIXED
- ❌ Employee fills actuals → lines disappear after save/sign
- ❌ Lines "move to RO" and RO can only sign via proxy-sign (wrong behavior)
- **Root Cause**: Frontend uses `/actuals?period_id=...` (requires RO/Finance/Admin) instead of `/actuals/my` for Employee role
- **Expected**: Employee sees their lines always, can sign own actuals. RO proxy-sign only for absent employees.

**2. Approvals Flow Broken:** ✅ FIXED
- ❌ Approvals do not route to Director at all
- ❌ Approvals tab does not update/refresh after actions
- **Root Cause**: Director step may not be activating after RO approval; frontend not refreshing inbox
- **Expected**: Employee sign → RO step → Director step (skip if RO==Director). Inbox updates immediately.

**3. Finance Cannot Create Projects:** ✅ FIXED
- ❌ Finance role cannot create new Projects
- **Root Cause**: `/admin/projects` POST endpoint restricted to Admin only
- **Expected**: Finance can create/edit Projects (and other master data as needed)

**4. Frontend UI Unpolished:**
- ❌ Inconsistent design, large empty spaces, not enterprise-ready
- **Expected**: Modern enterprise web app appearance with consistent Fluent UI v9 design

**5. Finance Needs Expanded Permissions:** 🔄 NEW REQUIREMENT
- ❌ Finance cannot create/edit: Departments, Cost Centers, Resources, Placeholders, Holidays
- ❌ Finance cannot edit Demand/Supply lines (gaps)
- **Expected**: Finance should have Admin-like permissions for master data management and planning gap resolution

---

## Phase 1 — Fix Actuals Visibility & Sign Behavior ✅

### P1.1 Fix Employee Actuals Visibility ✅
- [x] Update `frontend/src/pages/Actuals.tsx` to detect Employee role
- [x] Use `actualsApi.getMyActuals()` for Employee role instead of `getActualLines(periodId)`
- [x] Ensure Employee can see all their lines (draft, signed, approved) regardless of state
- [x] Test: Employee creates line → still visible after save → still visible after sign
- **Acceptance**: Employee lines never disappear, always visible in their view ✅

### P1.2 Fix Employee Sign Action ✅
- [x] Ensure Employee can sign their own actuals (not just RO proxy-sign)
- [x] Hide proxy-sign button for Employee role (only show for RO)
- [x] Update sign dialog to show correct action based on role
- [x] Test: Employee can sign own actuals, RO can proxy-sign with reason
- **Acceptance**: Employee signs own actuals; RO proxy-sign is separate optional action ✅

### P1.3 Fix Backend Actuals Endpoints ✅
- [x] Verify `/actuals/my` endpoint returns all employee lines (draft + signed)
- [x] Ensure `/actuals/my` filters by resource linked to current user
- [x] Test: Employee creates → signs → still sees line via `/actuals/my`
- **Acceptance**: Backend `/actuals/my` returns correct data for Employee ✅

---

## Phase 2 — Fix Approvals Routing & Refresh ✅

### P2.1 Fix Director Step Activation ✅
- [x] Inspect `api/app/services/approvals.py` `approve_step()` method
- [x] Ensure when RO approves Step 1, Director Step 2 becomes active (if not skipped)
- [x] Verify Director inbox filtering includes activated Director steps
- [x] Test: Employee signs → RO approves → Director inbox shows item
- **Acceptance**: Director receives approvals after RO approval ✅

### P2.2 Fix Approvals Inbox Refresh ✅
- [x] Update `frontend/src/pages/Approvals.tsx` to refetch after approve/reject
- [x] Ensure `loadApprovals()` is called after successful actions
- [x] Add loading state during refresh
- [x] Add manual refresh button
- [x] Test: RO approves → inbox updates immediately without manual reload
- **Acceptance**: Approvals inbox updates immediately after actions ✅

### P2.3 Verify Skip Rule ✅
- [x] Test: If RO==Director, Step 2 should be SKIPPED
- [x] Verify instance status becomes APPROVED when all steps done/skipped
- **Acceptance**: Skip rule works correctly ✅

---

## Phase 3 — Finance Can Create Projects ✅

### P3.1 Update Admin Router Permissions ✅
- [x] Update `api/app/routers/admin.py` to allow Finance for project CRUD
- [x] Create `PROJECT_WRITE_ROLES = (UserRole.ADMIN, UserRole.FINANCE)`
- [x] Apply to POST/PATCH/DELETE `/admin/projects` endpoints
- [x] Keep other master data (departments, cost centers) Admin-only for now
- **Acceptance**: Finance can create/update/delete projects (403 → 201) ✅

### P3.2 Update Frontend Admin Page ✅
- [x] Ensure Finance role sees "Create Project" button in Admin page
- [x] Test: Finance creates project → appears in PM demand dropdown
- **Acceptance**: Finance can create projects via UI ✅

### P3.3 Add Tests ✅
- [x] Test: Finance POST `/admin/projects` → 201
- [x] Test: PM POST `/admin/projects` → 403
- [x] Test: Finance-created project is tenant-scoped
- **Acceptance**: Tests pass ✅

---

## Phase 4 — Finance Expanded Permissions (NEW)

### P4.1 Finance Master Data Write Access

**Goal**: Finance can create/edit/delete all master data (departments, cost centers, resources, placeholders, holidays) similar to Admin.

**Backend Changes:**
- [ ] Create `MASTER_DATA_WRITE_ROLES = (UserRole.ADMIN, UserRole.FINANCE)` constant in `api/app/routers/admin.py`
- [ ] Update all POST/PATCH/DELETE endpoints for:
  - [ ] `/admin/departments` (POST, PATCH, DELETE)
  - [ ] `/admin/cost-centers` (POST, PATCH, DELETE)
  - [ ] `/admin/resources` (POST, PATCH, DELETE)
  - [ ] `/admin/placeholders` (POST, PATCH, DELETE)
  - [ ] `/admin/holidays` (POST, DELETE - note: holidays may not have PATCH)
- [ ] Keep `WRITE_ROLES = (UserRole.ADMIN,)` for Settings (Finance should not manage system settings)
- [ ] Update docstrings to reflect Finance access

**Frontend Changes:**
- [ ] Update `frontend/src/pages/Admin.tsx` to show create/edit buttons for Finance role
- [ ] Ensure Finance sees all master data tabs (Departments, Cost Centers, Projects, Resources, Placeholders, Holidays)
- [ ] Test: Finance can create department → create cost center → create resource → create placeholder → create holiday

**Tests:**
- [ ] Test: Finance POST `/admin/departments` → 201
- [ ] Test: Finance POST `/admin/cost-centers` → 201
- [ ] Test: Finance POST `/admin/resources` → 201
- [ ] Test: Finance POST `/admin/placeholders` → 201
- [ ] Test: Finance POST `/admin/holidays` → 201
- [ ] Test: PM POST `/admin/departments` → 403 (still restricted)
- [ ] Test: Finance PATCH/DELETE operations work

**Acceptance Criteria:**
- Finance can create/edit/delete all master data types
- PM/RO/Employee still cannot create master data (403)
- Finance cannot manage Settings (remains Admin-only)
- All operations are tenant-scoped

---

### P4.2 Finance Can Edit Demand/Supply Lines

**Goal**: Finance can create/edit/delete demand and supply lines to resolve gaps and adjust planning.

**Backend Changes:**
- [ ] Update `api/app/routers/planning.py`:
  - [ ] Change `create_demand_line` endpoint from `require_roles(UserRole.PM)` to `require_roles(UserRole.PM, UserRole.FINANCE)`
  - [ ] Change `update_demand_line` endpoint to allow Finance
  - [ ] Change `delete_demand_line` endpoint to allow Finance
  - [ ] Change `create_supply_line` endpoint from `require_roles(UserRole.RO)` to `require_roles(UserRole.RO, UserRole.FINANCE)`
  - [ ] Change `update_supply_line` endpoint to allow Finance
  - [ ] Change `delete_supply_line` endpoint to allow Finance
- [ ] Update docstrings to reflect Finance can edit planning lines
- [ ] Ensure all business rules still apply (XOR, 4MFC, FTE validation, period lock)

**Frontend Changes:**
- [ ] Update `frontend/src/pages/Demand.tsx`:
  - [ ] Remove read-only mode for Finance role
  - [ ] Show create/edit/delete buttons for Finance
  - [ ] Ensure Finance can see and edit all demand lines
- [ ] Update `frontend/src/pages/Supply.tsx`:
  - [ ] Remove read-only mode for Finance role
  - [ ] Show create/edit/delete buttons for Finance
  - [ ] Ensure Finance can see and edit all supply lines
- [ ] Remove or update `ReadOnlyBanner` component usage for Finance on planning pages

**Tests:**
- [ ] Test: Finance POST `/demand-lines` → 201
- [ ] Test: Finance PATCH `/demand-lines/{id}` → 200
- [ ] Test: Finance DELETE `/demand-lines/{id}` → 200
- [ ] Test: Finance POST `/supply-lines` → 201
- [ ] Test: Finance PATCH `/supply-lines/{id}` → 200
- [ ] Test: Finance DELETE `/supply-lines/{id}` → 200
- [ ] Test: Finance edits still enforce XOR rule
- [ ] Test: Finance edits still enforce 4MFC rule
- [ ] Test: Finance edits still blocked by period lock
- [ ] Test: PM can still edit demand (not broken)
- [ ] Test: RO can still edit supply (not broken)

**Acceptance Criteria:**
- Finance can create/edit/delete demand lines
- Finance can create/edit/delete supply lines
- All business rules (XOR, 4MFC, period lock) still enforced
- PM and RO permissions unchanged

---

### P4.3 Update Permissions List

**Goal**: Update `/me` endpoint to reflect Finance's expanded permissions.

**Backend Changes:**
- [ ] Update `api/app/routers/me.py` `get_permissions_for_role()`:
  - [ ] Add to Finance permissions:
    - [ ] `"manage:departments"`
    - [ ] `"manage:cost_centers"`
    - [ ] `"manage:projects"` (already implied)
    - [ ] `"manage:resources"`
    - [ ] `"manage:placeholders"`
    - [ ] `"manage:holidays"`
    - [ ] `"write:demand"`
    - [ ] `"write:supply"`
- [ ] Keep `"manage:settings"` Admin-only

**Frontend Changes:**
- [ ] Update any permission checks in frontend if they use the permissions list
- [ ] Ensure Admin page shows correct tabs/buttons based on permissions

**Tests:**
- [ ] Test: Finance `/me` endpoint returns expanded permissions list
- [ ] Test: Admin `/me` still returns full permissions
- [ ] Test: PM `/me` still returns limited permissions

**Acceptance Criteria:**
- Finance permissions list includes all new manage/write permissions
- Other roles' permissions unchanged

---

## Phase 5 — Enterprise UI Refresh

### P5.1 AppShell Improvements
- [ ] Update `frontend/src/components/AppShell.tsx`:
  - [ ] Better spacing, typography, consistent max-width
  - [ ] Top bar: tenant, role, current period selector
  - [ ] Side nav: consistent icons, active states, section grouping
  - [ ] Responsive: nav collapses on smaller widths
- **Acceptance**: AppShell looks professional and consistent

### P5.2 Dashboard Redesign
- [ ] Update `frontend/src/pages/Dashboard.tsx`:
  - [ ] Role-aware cards: "My pending actions", "Current period status", "Shortcuts"
  - [ ] Remove large empty space
  - [ ] Move "Seed Database" to dev-only banner (smaller)
  - [ ] Use Cards + MessageBars + skeleton loading
- **Acceptance**: Dashboard is informative and role-appropriate

### P5.3 Page Layout Consistency
- [ ] Create reusable `PageHeader` component (title + subtitle + primary actions)
- [ ] Create reusable `EmptyState` component
- [ ] Apply to all pages: Demand, Supply, Actuals, Approvals, Admin, Consolidation
- [ ] Consistent spacing using Fluent UI tokens
- **Acceptance**: All pages have consistent header and empty states

### P5.4 Table Improvements
- [ ] Sticky table headers
- [ ] Row hover states
- [ ] Inline validation for FTE fields (show errors immediately)
- [ ] Better empty states in tables
- **Acceptance**: Tables are polished and user-friendly

### P5.5 Visual Polish
- [ ] Use Fluent UI tokens for surfaces, border radius, shadows consistently
- [ ] Consistent button styles and icon usage
- [ ] Remove unprofessional labels (e.g., verbose "Your Permissions" chips)
- [ ] Keep compact "Permissions" panel in dev mode only
- [ ] Add loading skeletons (not just spinners)
- [ ] Add error message bars (no blank error pages)
- **Acceptance**: UI looks cohesive and enterprise-ready

---

## Phase 6 — Verification & Tests

### P6.1 Update Verification Doc
- [ ] Update `docs/VERIFY_LOCAL.md` with:
  - [ ] Finance creates project → PM uses it in demand
  - [ ] Employee actuals save + stay visible + sign
  - [ ] RO approvals → Director approvals
  - [ ] Approvals inbox refreshes
  - [ ] Finance creates department/cost center/resource/placeholder/holiday
  - [ ] Finance edits demand/supply lines to resolve gaps
- **Acceptance**: Verification doc covers all fixed flows

### P6.2 Add/Update Tests
- [ ] Test: Employee actuals visibility after sign
- [ ] Test: Approvals routing (RO → Director)
- [ ] Test: Finance create project allowed
- [ ] Test: Finance create all master data types
- [ ] Test: Finance edit demand/supply lines
- [ ] Test: Approvals inbox refresh
- **Acceptance**: All critical flows have test coverage

### P6.3 Final Manual Verification
- [ ] Run full end-to-end flow locally:
  1. Finance creates department, cost center, project, resource, placeholder, holiday
  2. Finance creates/edits demand line
  3. Finance creates/edits supply line
  4. PM adds demand with new project
  5. Employee adds actuals → signs → still sees lines
  6. RO sees approval → approves
  7. Director sees approval → approves
  8. Approvals inbox updates after each action
- **Acceptance**: All flows work end-to-end on localhost

---

## Execution Order

1. ✅ Create plan (Phase 0)
2. ✅ Fix Actuals visibility (Phase 1)
3. ✅ Fix Approvals routing (Phase 2)
4. ✅ Finance project creation (Phase 3)
5. 🔄 **Finance expanded permissions (Phase 4)** ← CURRENT
6. UI refresh (Phase 5)
7. Verification (Phase 6)

After each phase:
- Run `pytest` (backend tests)
- Run `npm run build` or verify `npm run dev` compiles
- Manually test the affected pages
- Fix any breakages before proceeding

---

## Phase 4 Implementation Details

### Backend Endpoints to Update

**Master Data (admin.py):**
- `POST /admin/departments` → Allow Finance
- `PATCH /admin/departments/{id}` → Allow Finance
- `DELETE /admin/departments/{id}` → Allow Finance
- `POST /admin/cost-centers` → Allow Finance
- `PATCH /admin/cost-centers/{id}` → Allow Finance
- `DELETE /admin/cost-centers/{id}` → Allow Finance
- `POST /admin/resources` → Allow Finance
- `PATCH /admin/resources/{id}` → Allow Finance
- `DELETE /admin/resources/{id}` → Allow Finance
- `POST /admin/placeholders` → Allow Finance
- `PATCH /admin/placeholders/{id}` → Allow Finance
- `DELETE /admin/placeholders/{id}` → Allow Finance
- `POST /admin/holidays` → Allow Finance
- `DELETE /admin/holidays/{id}` → Allow Finance

**Planning (planning.py):**
- `POST /demand-lines` → Allow Finance (currently PM only)
- `PATCH /demand-lines/{id}` → Allow Finance
- `DELETE /demand-lines/{id}` → Allow Finance
- `POST /supply-lines` → Allow Finance (currently RO only)
- `PATCH /supply-lines/{id}` → Allow Finance
- `DELETE /supply-lines/{id}` → Allow Finance

### Frontend Pages to Update

**Admin Page:**
- Show create/edit buttons for Finance role
- Ensure all master data tabs are accessible to Finance

**Demand Page:**
- Remove read-only mode for Finance
- Show create/edit/delete buttons for Finance

**Supply Page:**
- Remove read-only mode for Finance
- Show create/edit/delete buttons for Finance

### Test Coverage Required

**Master Data Tests:**
- Finance can create/edit/delete each master data type
- PM/RO/Employee cannot create master data (403)
- Finance cannot manage Settings (403)

**Planning Tests:**
- Finance can create/edit/delete demand lines
- Finance can create/edit/delete supply lines
- Business rules still enforced (XOR, 4MFC, period lock)
- PM can still edit demand, RO can still edit supply
