# Resource Allocation App (MatKat 2.0)

Multi-tenant resource allocation and planning system built with FastAPI and React.

---

## Features

- **Multi-tenant architecture** with strict tenant isolation
- **Role-based access control**: Admin, Finance, PM, RO, Director, Employee
- **Planning**: Demand and Supply management with period-based (month/year) planning, 4-month forecast window, and FTE% in 5% increments
- **Actuals**: Employee time tracking with ≤100% enforcement per resource/month, proxy sign by RO, and approval workflow
- **Approvals**: RO → Director workflow, automatic skip if RO=Director, inbox refreshes instantly after actions
- **Consolidation**: Finance dashboard with demand/supply gap analysis, cost center work queue, KPI scoreboard, and snapshot publishing (immutable period snapshots)
- **Notifications**: Azure Functions stub for scheduled reminders (future)
- **Audit Trail**: All master data and planning changes are logged with before/after values and user info
- **Master Data Management**: Finance and Admin can manage departments, cost centers, projects, resources, placeholders, holidays, and settings
- **Planning Insights**: PM/RO/Finance/Admin can view demand/supply gaps, orphan demand, and over-allocations per cost center
- **Read-only UI**: Users without edit permissions see clear banners and disabled actions
- **Dev Auth Bypass**: Switch roles and tenants instantly for local testing
- **Comprehensive Test Coverage**: 100+ backend tests, frontend smoke/unit tests

---

## Status

✅ **All core functionality implemented and tested**
- All major flows verified (see checklist below)
- All backend tests pass (`pytest`)
- TypeScript frontend builds cleanly (`npm run build`)
- Enterprise UI refresh with Fluent UI v9, responsive layouts, and accessibility
- See [`docs/TODO.md`](docs/TODO.md) and [`docs/VERIFY_LOCAL.md`](docs/VERIFY_LOCAL.md) for completion and verification status

---

## Tech Stack

### Backend
- FastAPI (Python 3.11+)
- SQLAlchemy 2.x + Alembic (migrations)
- SQLite (dev) / Azure SQL (production)
- pytest for testing

### Frontend
- React 18 + TypeScript
- Vite
- Fluent UI v9 (design system)
- MSAL React (Azure AD authentication)
- Recharts, D3 (charts)

### Scheduler
- Azure Functions (Python)
- Timer triggers for notifications (stub)

---

## Project Structure

```
ResourceAllocation/
├── api/                 # FastAPI backend
│   ├── app/
│   │   ├── models/      # SQLAlchemy models
│   │   ├── routers/     # API endpoints
│   │   ├── services/    # Business logic
│   │   └── schemas/     # Pydantic schemas
│   ├── alembic/         # Database migrations
│   └── tests/           # pytest tests
├── frontend/            # React frontend
│   └── src/
│       ├── pages/       # Page components
│       ├── components/  # Reusable components
│       └── api/         # API client
├── scheduler/           # Azure Functions (notifications)
└── scripts/             # Utility scripts (start, migration, etc.)
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Git

### Backend Setup

**Windows PowerShell:**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r api/requirements.txt
cd api
Copy-Item env.example.txt .env
# Edit .env: set DEV_AUTH_BYPASS=true for local dev
alembic upgrade head
pytest
cd ..
uvicorn api.app.main:app --reload
```

**Linux/Mac (bash):**
```bash
python -m venv venv
source venv/bin/activate
pip install -r api/requirements.txt
cd api
cp env.example.txt .env
# Edit .env: set DEV_AUTH_BYPASS=true for local dev
alembic upgrade head
pytest
cd ..
uvicorn api.app.main:app --reload
```

**Note:** Run the backend from the repo root so that `api.app.main` imports work. If running from `api/`, set `PYTHONPATH=..`.

### Frontend Setup

**Windows PowerShell:**
```powershell
cd frontend
npm install
Copy-Item env.example.txt .env.local
# Edit .env.local:
#   VITE_DEV_AUTH_BYPASS=true
#   VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

**Linux/Mac (bash):**
```bash
cd frontend
npm install
cp env.example.txt .env.local
# Edit .env.local:
#   VITE_DEV_AUTH_BYPASS=true
#   VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

---

## Development Mode

- Set `DEV_AUTH_BYPASS=true` in both backend and frontend `.env` files
- Use the Dev Login Panel in the frontend to switch roles and tenants instantly

---

## Example Data

- On first startup (dev mode, empty DB), the backend auto-creates sample data:
  - **Departments**: Engineering, Operations, Sales & Marketing, Customer Support
  - **Cost Centers**: Software Development, QA, Infrastructure, DevOps, Marketing, Support Team
  - **Users**: All roles (Admin, Finance, PMs, ROs, Directors, Employees) with manager chains
  - **Projects**: Alpha, Beta, Gamma, Infrastructure Upgrade, Marketing Campaign
  - **Resources**: Employees and external contractors
  - **Placeholders**: For future hiring
  - **Periods**: December 2025 (locked), January 2026 (locked), February-May 2026 (open)
  - **Demand/Supply/Actual lines**: Example planning and actuals data
  - **Approvals**: Example approval instances for signed actuals

- **To reset example data:**  
  Delete `api/dev.db` and restart the backend. Data will be recreated.

- **Dev endpoints:**  
  `/dev/seed`, `/dev/seed/run`, `/dev/seed/wipe` for advanced seeding (see [`frontend/src/api/devSeed.ts`](frontend/src/api/devSeed.ts)).

---

## Testing

```bash
# Backend tests
cd api
pytest -v

# Frontend build & test
cd frontend
npm run build
npm run test
```

- **All backend tests must pass**
- Frontend must build without TypeScript errors

---

## Local Run Guide

### Prerequisites Check
1. **Backend running**: `uvicorn api.app.main:app --reload` (http://localhost:8000)
2. **Frontend running**: `npm run dev` in `frontend/` (http://localhost:5173)
3. **Dev auth bypass enabled**: `DEV_AUTH_BYPASS=true` in both `.env` files
4. **Example data**: Auto-created on first startup if DB is empty

---

## Manual Test Checklist

#### 1. Finance Role - Period Control
- [ ] Login as Finance (Dev Login Panel)
- [ ] Create/lock/unlock periods, verify status changes

#### 2. PM Role - Demand Planning
- [ ] Create demand lines (FTE 5-100, step 5)
- [ ] Test XOR resource/placeholder rule
- [ ] Test 4MFC placeholder rule (future months only)
- [ ] Finance/Admin see Demand in read-only mode

#### 3. RO Role - Supply Planning
- [ ] Create supply lines (FTE 5-100, step 5)
- [ ] Finance/Admin see Supply in read-only mode

#### 4. Employee Role - Actuals Entry
- [ ] Create actual lines (≤100% per resource/month)
- [ ] Test over-100% block, sign actuals

#### 5. RO Role - Proxy Sign & Approvals
- [ ] Proxy sign for employees, verify approval instance, approve Step 1

#### 6. Director Role - Approvals
- [ ] Approve Step 2, test skip rule if RO=Director

#### 7. Finance Role - Consolidation & Publish
- [ ] View dashboard, publish snapshot, verify immutability

#### 8. Error Handling
- [ ] Invalid FTE → FTE_INVALID error
- [ ] Locked period edit → PERIOD_LOCKED error
- [ ] Unauthorized action → UNAUTHORIZED_ROLE error
- [ ] All errors use Problem Details format

#### 9. Multi-tenancy
- [ ] Switch tenants, verify strict data isolation

---

## API Documentation

- Swagger UI: http://localhost:8000/docs
- Health check: http://localhost:8000/healthz

---

## Environment Variables

See [`api/env.example.txt`](api/env.example.txt) and [`frontend/env.example.txt`](frontend/env.example.txt) for required variables.

---

## Documentation

- [docs/TODO.md](docs/TODO.md): Full implementation plan and completion status
- [docs/VERIFY_LOCAL.md](docs/VERIFY_LOCAL.md): Localhost verification checklist
- [docs/START_LOCAL.md](docs/START_LOCAL.md): Local run and troubleshooting guide
- [docs/TODO-planning.md](docs/TODO-planning.md): Planning UX improvements and acceptance criteria
- [frontend/docs/UI_GUIDELINES.md](frontend/docs/UI_GUIDELINES.md): UI design guidelines and component patterns

---

## License

Proprietary - Internal use only
