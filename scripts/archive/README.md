# Archived one-off scripts

These scripts are kept for historical reference only. They are not part of any
current operational process and should not be executed without review.

- `check_indexes.py` — one-off diagnostic that queried SQL Server index metadata
  for the `cost_centers` table.
- `split_qc_prod.py` — one-off PRODUCTION data migration that split the Quality
  Control cost center (DK/PL) and reassigned users. Contains hardcoded prod
  Entra object IDs. Kept as a record of what was executed; do not re-run.
- `script_add_initials_column.py` — ad-hoc migration adding `resources.initials`
  to local SQLite files. Superseded by Alembic migration
  `20260211_000012_resource_initials`.

Active operational scripts live in `api/` (e.g. `cleanup_transactional_data.py`,
`add_period_years.py`, `import_demand_csv.py`) and `api/scripts/`.
