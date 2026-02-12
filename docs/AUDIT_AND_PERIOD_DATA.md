# Audit and Period Lock Data

## Where data is stored

### Period lock

Stored in the **Period** model ([api/app/models/core.py](api/app/models/core.py)):

- **status** – `open` or `locked`
- **locked_at** – datetime when the period was locked (nullable)
- **locked_by** – user object_id who locked it (nullable)
- **lock_reason** – text; in the current implementation this stores the **reason for the last unlock** (see [api/app/services/period.py](api/app/services/period.py) line 157)

### Unlock reason

1. **Period.lock_reason** – holds the reason text for the most recent unlock (reused field).
2. **audit_logs** – every unlock is logged with `action="unlock"`, `entity_type="Period"`, `entity_id=<period_id>`, and `reason=<reason text>`.

### Audit data

Stored in the **audit_logs** table ([api/app/models/audit.py](api/app/models/audit.py)):

| Column       | Type     | Description                          |
|-------------|----------|--------------------------------------|
| id          | string   | Primary key                          |
| tenant_id   | string   | Tenant scope                         |
| timestamp   | datetime | When the action occurred             |
| user_id     | string   | Actor (object_id)                    |
| user_email  | string   | Actor email                          |
| action      | string   | create, update, delete, lock, unlock, sign, approve, etc. |
| entity_type | string   | e.g. Period, DemandLine, ActualLine  |
| entity_id   | string   | ID of the entity (nullable)          |
| old_values  | text     | JSON string (nullable)               |
| new_values  | text     | JSON string (nullable)               |
| reason      | text     | Optional reason (e.g. unlock)       |
| ip_address  | string   | Optional client IP                   |

## API

**List audit logs:** `GET /audit-logs/`

- **Query params:** `limit` (default 100, max 1000), `offset` (default 0)
- **Response:** List of objects with `timestamp`, `user_email`, `action`, `entity_type`, `entity_id`, `old_values`, `new_values`, `reason`, `ip_address`
- **Access:** Admin and Finance only. Tenant-scoped.

Defined in [api/app/routers/audit.py](api/app/routers/audit.py).
