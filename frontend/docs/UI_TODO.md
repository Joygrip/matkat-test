# Enterprise UI Redesign - Ferrosan Medical Devices

## Overview
Redesign the frontend to look like a high-end enterprise app branded for Ferrosan Medical Devices, using Fluent UI v9.

## Milestones

### M1 — Theme & Ferrosan Brand Tokens ✅ COMPLETE
**Goal:** Consistent enterprise look using Ferrosan blue.

**Tasks:**
- [x] Create `frontend/src/theme/ferrosanTheme.ts` with brand colors
- [x] Set primary to Ferrosan blue (#1a1a2e / #16213e from logo)
- [x] Define semantic colors (success/warn/danger/info)
- [x] Apply theme globally via ThemeProvider
- [x] Add consistent surfaces and typography

**Acceptance:** ✅ Whole app uses one coherent theme; buttons/selected nav reflect the brand.

---

### M2 — Enterprise AppShell (Logo Slot, Nav, Top Bar, Responsive) ✅ COMPLETE
**Goal:** Polished structure with Ferrosan branding.

**Tasks:**
- [x] Upgrade `AppShell.tsx` with logo slot
- [x] Add Ferrosan logo/text branding in top-left
- [x] Role-aware nav items (only show what role needs)
- [x] Top bar with page title + period selector
- [x] User capsule in nav bottom
- [x] Responsive behavior (nav collapses on small screens)

**Acceptance:** ✅ Layout looks like modern enterprise SPA; nav and top bar consistent across pages.

---

### M3 — Role-based Dashboards (Remove Noise for Users) ✅ COMPLETE
**Goal:** Non-admin dashboards show only actionable items; admin sees system panels.

**Tasks:**
- [x] Split dashboard: User Dashboard vs Admin System Dashboard
- [x] Non-admin: "My actions" cards (Sign actuals / Approvals pending / Planning due)
- [x] Non-admin: "Current period status" banner
- [x] Non-admin: "Quick links" tiles
- [x] Admin-only: Seed Database button (DEV-only + Admin-only)
- [x] Admin-only: System status (API health/version/env)
- [x] Admin-only: Tenant details
- [x] Admin-only: Permissions viewer (collapsed by default)

**Acceptance:** ✅ PM/RO/Employee/Director/Finance see clean, action-focused dashboard. Admin still has system tools.

---

### M4 — Shared UI Components + Page Standards ✅ COMPLETE
**Goal:** Consistent, reusable patterns.

**Tasks:**
- [x] Create `PageHeader` component (title, subtitle, actions)
- [x] Create `StatusBanner` component (locked period, warnings)
- [x] Create `ActionCard` / `KpiCard` components
- [x] Create `EmptyState` component
- [x] Create `LoadingState` / skeleton pattern
- [x] Standardize toast wrapper styling

**Acceptance:** ✅ Pages share same header/spacing patterns; loading/empty/error are consistent.

---

### M5 — Page-by-Page Modernization ✅ COMPLETE
**Goal:** Each page looks cohesive, modern, and "enterprise".

**Tasks:**
- [x] **Demand/Supply/Actuals:**
  - Sticky header, comfortable row height, consistent column spacing
  - Inline validation styling (FTE step/range)
  - Clear "Save / Discard" actions and summary panel
  - Reduce clutter; align numeric columns; add empty state
  - Read-only mode visually obvious (banner + disabled controls)
- [x] **Approvals:**
  - Inbox layout with grouping
  - Approve/reject dialog with comment
  - Status chips per step (RO/Director)
  - Success toast and refresh after actions
- [x] **Consolidation:**
  - Finance-focused layout with clear status
  - Better tables, filters (basic), publish confirmation
- [x] **Admin:**
  - Clean master data tables with "Create" button on header
  - Use modals/drawers consistently

**Acceptance:** ✅ Each page looks cohesive, modern, and "enterprise". No page has large empty whitespace or inconsistent typography.

---

### M6 — Final Consistency Pass ✅ COMPLETE
**Goal:** UI feels unified; no "prototype" look remains.

**Tasks:**
- [x] Remove leftover debug UI hints from non-admin surfaces
- [x] Ensure icons are consistent (Fluent icons)
- [x] Ensure spacing/padding standards applied across all pages
- [x] Ensure TypeScript strictness remains satisfied
- [x] Ensure `npm run build` passes

**Acceptance:** ✅ UI feels unified; no "prototype" look remains. Build passes successfully.

---

## Testing Requirements

After each milestone:
- Run `npm run build` (or `npm run typecheck` if present)
- Run `npm run dev` quick smoke (ensure no runtime crash)
- Keep changes incremental and reviewable
- Update checkboxes as completed

## Final Deliverables

- [x] Modern enterprise look with Ferrosan branding
- [x] Role-appropriate dashboards
- [x] Consistent layouts across all pages
- [x] Shared component library
- [x] All pages modernized
- [x] TypeScript builds pass
- [x] App remains runnable throughout
