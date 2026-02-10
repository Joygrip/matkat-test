# Planning UX Verification Checklist

## Prerequisites
- Backend running on `http://localhost:8000`
- Frontend running on `http://localhost:5173`
- DEV_AUTH_BYPASS enabled
- At least one open period exists

---

## Phase 1 Verification: Remove Year/Month Inputs

### PM Role - Demand Planning
1. [ ] Log in as PM role
2. [ ] Navigate to Demand Planning page
3. [ ] Verify period selector is visible at top of page
4. [ ] Click "Add Demand" button
5. [ ] **Verify:** Modal does NOT show Year or Month input fields
6. [ ] **Verify:** Modal shows selected period as read-only text (e.g., "Period: February 2026 (open)")
7. [ ] Fill in Project, Resource/Placeholder, FTE%
8. [ ] Click Create
9. [ ] **Verify:** Demand line is created for the selected period
10. [ ] Change period selector to different period
11. [ ] **Verify:** Demand lines list updates to show lines for new period

### RO Role - Supply Planning
1. [ ] Log in as RO role
2. [ ] Navigate to Supply Planning page
3. [ ] Verify period selector is visible at top of page
4. [ ] Click "Add Supply" button
5. [ ] **Verify:** Modal does NOT show Year or Month input fields
6. [ ] **Verify:** Modal shows selected period as read-only text
7. [ ] Fill in Resource, FTE%
8. [ ] Click Create
9. [ ] **Verify:** Supply line is created for the selected period
10. [ ] Change period selector to different period
11. [ ] **Verify:** Supply lines list updates to show lines for new period

---

## Phase 2 Verification: FTE% 5% Increments

### PM Role - Demand Planning
1. [ ] Log in as PM role
2. [ ] Navigate to Demand Planning page
3. [ ] Click "Add Demand" button
4. [ ] **Verify:** FTE% field is a dropdown/select (not free text)
5. [ ] **Verify:** Dropdown shows values: 5, 10, 15, 20, ..., 100
6. [ ] Select valid FTE% (e.g., 50)
7. [ ] Create demand line
8. [ ] **Verify:** Demand line created successfully
9. [ ] Try to manually type invalid value (e.g., 12, 33, 7) if possible
10. [ ] **Verify:** Invalid values are blocked or show error

### RO Role - Supply Planning
1. [ ] Log in as RO role
2. [ ] Navigate to Supply Planning page
3. [ ] Click "Add Supply" button
4. [ ] **Verify:** FTE% field is a dropdown/select
5. [ ] **Verify:** Dropdown shows values: 5, 10, 15, 20, ..., 100
6. [ ] Select valid FTE% (e.g., 75)
7. [ ] Create supply line
8. [ ] **Verify:** Supply line created successfully

### Backend Validation Test
1. [ ] Run pytest: `test_demand_create_invalid_fte_12` -> should return 400
2. [ ] Run pytest: `test_supply_create_invalid_fte_33` -> should return 400
3. [ ] Run pytest: `test_demand_create_valid_fte_50` -> should return 201
4. [ ] Run pytest: `test_supply_create_valid_fte_75` -> should return 201

---

## Phase 3 Verification: Planning Insights

### PM Role - Demand Insights
1. [ ] Log in as PM role
2. [ ] Navigate to Demand Planning page
3. [ ] **Verify:** "Insights" tab is visible
4. [ ] Click "Insights" tab
5. [ ] **Verify:** Summary cards show:
   - Total Demand %
   - Total Supply %
   - Total Gap %
6. [ ] **Verify:** Table shows gaps by Cost Center
7. [ ] **Verify:** Negative gaps (demand > supply) are highlighted
8. [ ] **Verify:** Orphan demand list shows any placeholder/inactive resource demand
9. [ ] Go back to "Demand Lines" tab
10. [ ] Create a new demand line
11. [ ] Switch back to "Insights" tab
12. [ ] **Verify:** Insights updated with new demand line

### RO Role - Supply Insights
1. [ ] Log in as RO role
2. [ ] Navigate to Supply Planning page
3. [ ] **Verify:** "Insights" tab is visible
4. [ ] Click "Insights" tab
5. [ ] **Verify:** Summary cards show demand/supply/gap totals
6. [ ] **Verify:** Table shows gaps by Cost Center
7. [ ] Go back to "Supply Lines" tab
8. [ ] Create a new supply line
9. [ ] Switch back to "Insights" tab
10. [ ] **Verify:** Insights updated with new supply line

### Finance/Admin Role - Insights Access
1. [ ] Log in as Finance role
2. [ ] Navigate to Demand or Supply Planning page
3. [ ] **Verify:** "Insights" tab is visible (read-only)
4. [ ] Click "Insights" tab
5. [ ] **Verify:** Can view insights but cannot edit

---

## Phase 4 Verification: Final Checks

### Build & Tests
1. [ ] Run `cd api && pytest` - all tests pass
2. [ ] Run `cd frontend && npm run build` - no TypeScript errors
3. [ ] Run `cd frontend && npm run dev` - app starts without errors

### Documentation
1. [ ] README updated with planning changes
2. [ ] `docs/VERIFY_PLANNING.md` exists and is complete
3. [ ] `docs/TODO-planning.md` shows all items completed

---

## Expected Behavior Summary

✅ **Year/Month removed:** Users never type year/month; it's derived from selected period
✅ **FTE% increments:** Only values 5, 10, 15, ..., 100 are allowed
✅ **Planning Insights:** PM and RO can see demand/supply gaps and conflicts
✅ **Auto-refresh:** Insights update when demand/supply changes or period changes
