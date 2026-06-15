# Data Model

Core SQLAlchemy models live in `api/app/models/`. Every business table carries an indexed
`tenant_id` for **multi-tenant isolation** — all queries filter by tenant, and there is no
cross-tenant data sharing. IDs are string UUIDs; most tables carry `created_at` / `updated_at`.

This is not an exhaustive column dump — it covers the fields and relationships a developer
needs to understand the model.

## Identity & organization

### User (`models/core.py`)
- `id`, `tenant_id`, `object_id` (Entra), `email`, `display_name`
- `role` (`UserRole`: Admin / Finance / PM / Manager / Employee / Reader)
- `secondary_role` (string, e.g. `"PM"` or `"Reader"` for combined roles)
- `manager_object_id` (direct manager, by Entra object id)
- `cost_center_id` → CostCenter
- `country`, `is_active`
- Unique on `(tenant_id, object_id)`.

### CostCenter (`models/core.py`)
- `id`, `tenant_id`, `code`, `name`
- `graph_department_name` (for sync auto-assignment)
- `ro_user_id` → User (**Resource Owner / owning manager**)
- `director_user_id` → User (**Director**, the second approval step)
- `sync_protected` (skip user reassignment during sync), `is_active`
- Relationships: `users`, `ro_user`, `director`, `resources`, `placeholders`.

### Project (`models/core.py`)
- `id`, `tenant_id`, `code`, `name`, `cost_center_id`, `start_date`, `end_date`, `is_active`
- **PM assignment** is many-to-many via the **ProjectPM** association table
  (`project_id`, `user_id`, `tenant_id`) → relationship `pm_users`. A project can have multiple PMs.

### Resource (`models/core.py`)
- `id`, `tenant_id`, `user_id` (optional → User), `cost_center_id` (**required**)
- `employee_id`, `display_name`, `initials`, `email`
- `resource_type` (`ResourceType`: EMPLOYEE / EXTERNAL / STUDENT / OOP), `hourly_cost`, `is_active`
- `is_oop` property = true when `resource_type != EMPLOYEE`.

### Period (`models/core.py`)
- `id`, `tenant_id`, `year`, `month`
- `monthly_fte_cost` (used by finance), `status` (`open` | `locked`)
- `locked_at`, `locked_by`, `lock_reason`
- Unique on `(tenant_id, year, month)`.

### Placeholder (`models/core.py`)
- `id`, `tenant_id`, `cost_center_id` (**required**), `name`, `description`, `skill_profile`,
  `estimated_cost`, `created_by` (null = system-created), `is_active`.
- Used in demand instead of a named resource; hard-deleted by planning cleanup when unreferenced.

## Planning

### DemandLine (`models/planning.py`)
- `id`, `tenant_id`, `period_id`, `project_id` (**required**), `year`, `month`
- **`resource_id` XOR `placeholder_id`** — exactly one must be set.
- `fte_percent` (5–100, step 5; enforced by CHECK constraints), `created_by`.
- Relationships: `project`, `resource?`, `placeholder?`.

### SupplyLine (`models/planning.py`)
- `id`, `tenant_id`, `period_id`, `resource_id` (**required**), `project_id` (optional —
  null = general availability), `year`, `month`, `fte_percent` (5–100, step 5), `created_by`.
- Unique on `(tenant_id, resource_id, project_id, year, month)`.

## Actuals & approvals

### ActualLine (`models/actuals.py`)
- `id`, `tenant_id`, `period_id`, `resource_id` (**required**), `project_id` (**required**),
  `year`, `month`
- `planned_fte_percent` (from supply), `actual_fte_percent` (0 or 5–100, step 5)
- Signing: `employee_signed_at`, `employee_signed_by`, `is_proxy_signed`, `proxy_sign_reason`
- RO approval: `ro_approved_at`, `ro_approved_by`
- `is_signed` property = `employee_signed_at is not None`.

### ApprovalInstance (`models/approvals.py`)
- `id`, `tenant_id`, `subject_type` (e.g. `"actuals"`), `subject_id`
- `status` (`pending` | `approved` | `rejected`), `created_by`
- Relationship: `steps` (ordered by `step_order`).

### ApprovalStep (`models/approvals.py`)
- `id`, `instance_id`, `step_order` (1 = Manager, 2 = Director), `step_name`
- `approver_id`, `status` (`pending` | `approved` | `rejected` | `skipped`)
- `actioned_at`, `actioned_by`, `comment`
- Unique on `(instance_id, step_order)`.

## Project costs

### ProjectExternalLine (`models/project_costs.py`) — out-of-pocket
- `id`, `tenant_id`, `project_id`, `period_id`, `resource_id?`, `description`, `notes`,
  `cost` (cents), `created_by`.

### ProjectEquipmentLine (`models/project_costs.py`) — equipment
- `id`, `tenant_id`, `project_id`, `period_id`, `description`, `cost` (cents), `created_by`.

## Audit & notifications

### AuditLog (`models/audit.py`)
- `id`, `tenant_id`, `created_at`, `user_id`, `user_email`
- `action` (`create` / `update` / `delete`), `entity_type`, `entity_id`
- `old_values`, `new_values` (JSON), `reason`, `ip_address`, `details` (enriched JSON context).

### NotificationSchedule (`models/notification_schedule.py`)
- `id`, `tenant_id`, `notification_type` (conflict_alerts / missing_actuals /
  planning_reminder / approval_reminder / approval_rejection)
- `trigger_type` (day_of_month / day_of_week / days_before_period_close), `trigger_value`, `time_of_day` (UTC)
- Recipient flags: `notify_pm`, `notify_manager`, `notify_finance`, `notify_employee`
- `excluded_emails` (JSON), `is_active`, `last_run_at`, `created_by`.

### NotificationLog (`models/notifications.py`)
- `id`, `tenant_id`, `phase` (PM_RO / Finance / Employee / RO_Director / ConflictAlert /
  MissingActuals), `year`, `month`, `recipient_user_id`, `recipient_email`
- `status` (pending / sent / failed), `message`, `error`, `run_id`, `idempotency_key` (unique),
  `retry_count`, `max_retries`, `sent_at`.

## Relationship summary

- **User → CostCenter** (many-to-one); CostCenter has `ro_user` (owning manager) and `director`.
- **Project ↔ User** many-to-many via **ProjectPM** (PM assignments).
- **Resource → CostCenter** (required) and optional **Resource → User** link.
- **DemandLine → Project** + (**Resource** XOR **Placeholder**).
- **SupplyLine → Resource** + optional **Project**.
- **ActualLine → Resource + Project**, per period.
- **ApprovalInstance → ApprovalStep** (one-to-many; Manager then Director).
- **Period** governs open/locked status and the monthly FTE cost used by finance.
- **`tenant_id`** is present on every business table and is the primary isolation key.
