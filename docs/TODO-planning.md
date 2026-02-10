# Planning UX Improvements - TODO

## Overview
Improve Demand/Supply planning UX by removing year/month inputs, enforcing FTE% increments, and adding Planning Insights for PM/RO.

## Phase 1 — Remove Year/Month Inputs (Bind to Selected Period) ✅
**Goal:** Page-level period selector is the single source of truth.

### Backend Tasks
- [ ] Update DemandLine create schema to make year/month optional (derive from periodId)
- [ ] Update SupplyLine create schema to make year/month optional (derive from periodId)
- [ ] Enforce year/month server-side from periodId in create/update endpoints
- [ ] Reject payloads with mismatching year/month (400 PERIOD_MISMATCH)
- [ ] Update API documentation/comments

### Frontend Tasks
- [ ] Remove Year/Month fields from Demand "Add Demand Line" modal
- [ ] Display selected period as read-only text in Demand modal
- [ ] Remove Year/Month fields from Supply "Add Supply Line" modal
- [ ] Display selected period as read-only text in Supply modal
- [ ] Ensure create requests pass periodId only (no year/month)
- [ ] Verify list queries refresh when period selector changes

### Acceptance Criteria
- ✅ Demand/Supply modals no longer show Year/Month inputs
- ✅ Lines are created for the selected period only
- ✅ Changing top period selector changes displayed lines
- ✅ Backend validates periodId and derives year/month

---

## Phase 2 — Enforce 5% Increments (API + UI) ✅
**Goal:** FTE% must be integer increments of 5 (5, 10, 15, ..., 100).

### Backend Tasks
- [ ] Add validation: ftePercent must be integer
- [ ] Add validation: 5 <= ftePercent <= 100
- [ ] Add validation: ftePercent % 5 == 0
- [ ] Apply to DemandLine create/update endpoints
- [ ] Apply to SupplyLine create/update endpoints
- [ ] Return Problem Details with code `FTE_INVALID` and clear message

### Frontend Tasks
- [ ] Replace FTE input with dropdown/select (5, 10, 15, ..., 100)
- [ ] Add inline validation to block invalid values
- [ ] Show toast + highlight field on server FTE_INVALID error
- [ ] Update Demand modal FTE input
- [ ] Update Supply modal FTE input

### Tests
- [ ] `test_demand_create_invalid_fte_12` -> 400 FTE_INVALID
- [ ] `test_supply_create_invalid_fte_33` -> 400 FTE_INVALID
- [ ] `test_demand_create_valid_fte_50` -> 201
- [ ] `test_supply_create_valid_fte_75` -> 201

### Acceptance Criteria
- ✅ Invalid FTE values blocked in UI (dropdown prevents entry)
- ✅ Invalid FTE values rejected by API (400 FTE_INVALID)
- ✅ Valid increments (5, 10, 15, ..., 100) work correctly

---

## Phase 3 — Planning Insights Tab for PM + RO ✅
**Goal:** PM and RO can see conflicts/gaps without Finance consolidation.

### Backend Tasks
- [ ] Create `GET /planning/insights?periodId=<id>` endpoint
- [ ] Compute demand vs supply gaps by cost center
- [ ] Compute top over-demanded cost centers
- [ ] Identify orphan demand lines (placeholders after 4MFC, inactive resources)
- [ ] Return stable response shape with period, byCostCenter, orphanDemand, stats
- [ ] Ensure endpoint accessible to PM/RO/Finance/Admin (read-only)

### Frontend Tasks
- [ ] Add "Insights" tab to Demand page (visible to PM)
- [ ] Add "Insights" tab to Supply page (visible to RO)
- [ ] Create Planning Insights component with:
  - Summary cards (Total demand, Total supply, Total gap)
  - Table: gaps by cost center with conditional formatting
  - Orphan demand list with reasons
- [ ] Refresh insights after demand/supply add/delete/update
- [ ] Refresh insights on period selector change

### Acceptance Criteria
- ✅ PM can open "Insights" tab and see demand/supply gaps
- ✅ RO can open "Insights" tab and see demand/supply gaps
- ✅ Insights update immediately after changes
- ✅ Finance/Admin can also view Insights (read-only)

---

## Phase 4 — Docs + Verify + Final Tests ✅
**Goal:** Documentation and verification complete.

### Tasks
- [ ] Update README with planning changes summary
- [ ] Create `docs/VERIFY_PLANNING.md` with manual checklist
- [ ] Ensure all pytest tests pass
- [ ] Run `npm run build` and verify no TypeScript errors
- [ ] Manual verification: PM flow (create demand, invalid FTE, insights)
- [ ] Manual verification: RO flow (create supply, invalid FTE, insights)

### Acceptance Criteria
- ✅ Documentation updated
- ✅ All tests pass
- ✅ Frontend builds without errors
- ✅ Manual verification checklist completed

---

## Notes
- Do not change core role permissions
- Do not change 4MFC placeholder rule
- Do not change XOR demand rule
- Do not change period lock behavior
- Keep multi-tenant enforcement intact
