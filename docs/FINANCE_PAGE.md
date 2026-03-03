# Finance Page

The Finance page provides an enterprise, action-oriented UI for consolidation, cost center analysis, and snapshot publishing.

## Layout

- **Compact header**: Title, subtitle, and primary actions (Publish Snapshot, Manage periods).
- **Sticky toolbar**: Period selector, cost center filter, view toggle (Overview | Cost Centers | Actuals | Snapshots), and last snapshot indicator.
- **KPI scoreboard**: Compact row with Demand, Supply, Gap, Orphan Demands, and Over-allocations. Click Orphan Demands or Over-allocations to filter the view.
- **Cost center work queue**: Two-pane layout (left ~35%, right ~65%) when viewing Cost Centers.

## Period Management (Drawer)

- Click **Manage periods** to open a right-side drawer.
- The drawer lists all periods with status badges (Open/Locked), lock date, and Lock/Unlock actions.
- **Lock**: A confirmation modal appears: "Locking will prevent further edits to planning data. Continue?"
- **Unlock**: Enter a reason in the dialog before unlocking.
- **Create period**: Available at the top of the drawer for Admin/Finance.

## Publish Snapshot Modal

- Click **Publish Snapshot** to open the modal.
- The modal shows: selected period, cost center count, warnings (orphan count, over-allocations), name, and optional description.
- Confirm to publish; Cancel to close.

## Cost Center Work Queue

- **Left pane**: Search box, sort options (Gap desc, Name, Demand, Supply), and a list of cost centers with Demand/Supply/Gap and issue chips.
- **Right pane**: Selected cost center details with tabs:
  - **Resources**: Table of resources with Demand, Supply, Gap, Status.
  - **Issues**: Orphan demands and over-allocations for that cost center.

## Snapshots View

- Switch to the **Snapshots** tab to see the snapshot list (Name, Description, Lines, Published At, Published By).
- **View** opens a dialog with snapshot lines (first 100).
- **Export** is available if the backend supports it.

## Data Flows

- Dashboard: `consolidationApi.getDashboard(periodId)` → summary + cost_centers + over_allocations
- Snapshots: `consolidationApi.getSnapshots(periodId)` → list; `publishSnapshot` for publishing
- Actuals: `/finance/actuals-dashboard` → FinanceActualRow[]; `getCostCenterStats` for charts
