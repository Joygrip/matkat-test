# Retired scripts

The repository no longer keeps diagnostic, operational, cleanup, or one-time
migration scripts in committed source. Such scripts are retained only in a
**local, off-repo archive** and are not part of the application, the dev
workflow, the test suite, or CI/CD.

## What was removed and where it went

The following scripts were moved out of the repository (last committed location →
off-repo archive `../matkat-local-script-archive/scripts/archive/`):

| Former path | Type | Notes |
|---|---|---|
| `api/import_demand_csv.py` | Demand CSV importer (env-guarded, dry-run default) | No app/endpoint equivalent. |
| `api/add_period_years.py` | Period-row inserter (env-guarded, dry-run default) | Status rule lives in `PeriodService.create_year` (`POST /periods/years`). |
| `api/cleanup_transactional_data.py` | Transactional-data cleanup (env-guarded, dry-run default) | Deletes planning/test data. |
| `api/diagnose_graph_hierarchy_dev.py` | Read-only Graph vs dev-SQL hierarchy diagnostic | Contained hardcoded employee UPNs. |
| `api/app/scripts/diagnose_cc_managers.py` | Read-only CC manager-assignment audit | `api/app/scripts/` package removed. |
| `scripts/archive/split_quality_control.py` | One-time QC cost-center split | UNSAFE to re-run (auto-commit, hardcoded prod IDs). |
| `scripts/archive/split_qc_prod.py` | One-time QC split (prod variant) | UNSAFE to re-run. |
| `scripts/archive/seed_signed_actuals.py` | Dev-only signed-actuals seed | No dev/prod guard. |
| `scripts/archive/script_add_initials_column.py` | Pre-Alembic column add | Superseded by migration `20260211_000012_resource_initials`. |
| `scripts/archive/check_indexes.py` | One-off index-metadata diagnostic | — |

## Tests removed/updated alongside

- `api/tests/test_import_demand_csv.py` — **deleted** (tested only the importer
  internals; no application coverage lost).
- `api/tests/test_periods.py` — **edited**: removed the `add_period_years` import
  and the `TestResolveStatusForYear` unit-test class. All period
  endpoint/service tests (including `TestCreateYear`, which exercises the same
  auto/open/locked rule against the real service) are retained.

## If you need one of these scripts

Retrieve it from the off-repo local archive, or from git history
(`git log --all --diff-filter=D -- <former-path>`). Review before running —
several write to or delete from a database, and the older one-time migrations
auto-commit against hardcoded production identifiers.
