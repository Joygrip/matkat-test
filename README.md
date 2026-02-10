# Resource Allocation App (MatKat 2.0)

Multi-tenant resource allocation and planning system built with FastAPI and React.

## Features

- **Multi-tenant architecture** with tenant isolation
- **Role-based access control** (Admin, Finance, PM, RO, Director, Employee)
- **Planning**: Demand and Supply management with 4-month forecast window
- **Actuals**: Time tracking with ≤100% enforcement per resource
- **Approvals**: RO → Director workflow with automatic skip when RO=Director
- **Consolidation**: Finance dashboard with gap analysis and snapshot publishing
- **Notifications**: Scheduled reminders (Azure Functions stub)

## Status

✅ **All core functionality implemented and tested**
- Localhost repair complete (CORS, error handling, dependencies)
- Enterprise UI refresh with read-only banners and role-aware navigation
- Comprehensive verification checklist in README
- See `docs/TODO.md` for detailed completion status

## Tech Stack

### Backend
- FastAPI (Python 3.11+)
- SQLAlchemy 2.x + Alembic
- SQLite (dev) / Azure SQL (production)
- pytest for testing

### Frontend
- React 18 + TypeScript
- Vite
- Fluent UI v9
- MSAL React (Azure AD authentication)

### Scheduler
- Azure Functions (Python)
- Timer triggers for notifications

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Git

### Backend Setup

**Windows PowerShell:**
```powershell
# Create virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies (from repo root)
pip install -r api/requirements.txt

# Set up environment
cd api
Copy-Item env.example.txt .env
# Edit .env with your settings (set DEV_AUTH_BYPASS=true for local dev)

# Run migrations
alembic upgrade head

# Run tests
pytest

# Start server (from repo root)
cd ..
uvicorn api.app.main:app --reload
```

**Linux/Mac (bash):**
```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies (from repo root)
pip install -r api/requirements.txt

# Set up environment
cd api
cp env.example.txt .env
# Edit .env with your settings (set DEV_AUTH_BYPASS=true for local dev)

# Run migrations
alembic upgrade head

# Run tests
pytest

# Start server (from repo root)
cd ..
uvicorn api.app.main:app --reload
```

**Note:** The backend must be run from the repo root so that `api.app.main` imports work correctly. If you need to run from the `api/` directory, set `PYTHONPATH=..` first.


### Frontend Setup

**Windows PowerShell:**
```powershell
cd frontend

# Install dependencies
npm install

# Set up environment
Copy-Item env.example.txt .env.local
# Edit .env.local with your settings:
#   VITE_DEV_AUTH_BYPASS=true
#   VITE_API_BASE_URL=http://localhost:8000

# Start dev server
npm run dev
```

**Linux/Mac (bash):**
```bash
cd frontend

# Install dependencies
npm install

# Set up environment
cp env.example.txt .env.local
# Edit .env.local with your settings:
#   VITE_DEV_AUTH_BYPASS=true
#   VITE_API_BASE_URL=http://localhost:8000

# Start dev server
npm run dev
```

### Development Mode

The app supports dev auth bypass for local development:

1. Set `DEV_AUTH_BYPASS=true` in both backend and frontend `.env` files
2. Use the dev login panel in the frontend to switch roles

### Example Data

In development mode, example data is automatically created on first startup if the database is empty. This includes:

- **4 Departments**: Engineering, Operations, Sales & Marketing, Customer Support
- **6 Cost Centers**: Software Development, QA, Infrastructure, DevOps, Marketing, Support Team
- **14 Users**: All roles (Admin, Finance, PMs, ROs, Directors, Employees) with manager chains
- **5 Projects**: Project Alpha, Beta, Gamma, Infrastructure Upgrade, Marketing Campaign
- **8 Resources**: Employee resources and external contractors
- **4 Placeholders**: For future hiring
- **6 Periods**: December 2025 (locked), January 2026 (locked), February-May 2026 (open)
- **10 Demand lines**: Across multiple projects and periods
- **9 Supply lines**: Resource capacity allocation
- **4 Actual lines**: January 2026 time tracking (locked period)
- **2 Approval instances**: With RO and Director steps (for signed actuals)

**To reset example data:**
- Delete `api/dev.db` and restart the backend
- Example data will be recreated automatically on next startup
3. Backend accepts `X-Dev-Role` and `X-Dev-Tenant` headers

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
└── scheduler/           # Azure Functions
```

## Testing

```bash
# Backend tests
cd api
pytest -v

# All tests should pass
```

## Local Run Guide

### Quick Start

1. **Backend** (from repo root):
   ```powershell
   # Windows PowerShell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r api/requirements.txt
   cd api
   Copy-Item env.example.txt .env
   # Edit .env: set DEV_AUTH_BYPASS=true
   alembic upgrade head
   cd ..
   uvicorn api.app.main:app --reload
   ```

2. **Frontend** (from repo root):
   ```powershell
   cd frontend
   npm install
   Copy-Item env.example.txt .env.local
   # Edit .env.local: set VITE_DEV_AUTH_BYPASS=true, VITE_API_BASE_URL=http://localhost:8000
   npm run dev
   ```

3. **Access**: http://localhost:5173 (use Dev Login Panel to switch roles)

### How to Verify Locally

### Prerequisites Check
1. **Backend running**: `uvicorn api.app.main:app --reload` (http://localhost:8000)
2. **Frontend running**: `npm run dev` in `frontend/` (http://localhost:5173)
3. **Dev auth bypass enabled**: Set `DEV_AUTH_BYPASS=true` in both `.env` files
4. **Example data**: Automatically created on first startup if database is empty (dev mode only)

### Manual Test Checklist

#### 1. Finance Role - Period Control
- [ ] Login as Finance (use Dev Login Panel)
- [ ] Navigate to Consolidation page
- [ ] Create a new period (year/month)
- [ ] Lock the period (requires reason)
- [ ] Verify period status shows "locked"
- [ ] Try to unlock/reopen (requires reason)
- [ ] Verify period status changes back to "open"

#### 2. PM Role - Demand Planning
- [ ] Login as PM
- [ ] Verify navigation shows: Dashboard, Demand (no Supply visible)
- [ ] Navigate to Demand page
- [ ] Create demand line with resource (FTE 5-100, step 5)
- [ ] Verify XOR: try to select both resource and placeholder → error
- [ ] Verify 4MFC: try placeholder in current month → blocked
- [ ] Create demand with placeholder for month 6+ months away → allowed
- [ ] Verify Finance/Admin see Demand in read-only mode (no edit buttons)

#### 3. RO Role - Supply Planning
- [ ] Login as RO
- [ ] Verify navigation shows: Dashboard, Demand, Supply, Actuals, Approvals
- [ ] Navigate to Supply page
- [ ] Create supply line (FTE 5-100, step 5)
- [ ] Verify Finance/Admin see Supply in read-only mode

#### 4. Employee Role - Actuals Entry
- [ ] Login as Employee
- [ ] Navigate to Actuals page
- [ ] Create actual line (project + resource + FTE)
- [ ] Create second line for same resource/month with total >100% → blocked with error showing total and offending IDs
- [ ] Create lines totaling exactly 100% → allowed
- [ ] Sign actuals → creates approval instance

#### 5. RO Role - Proxy Sign & Approvals
- [ ] Login as RO
- [ ] Navigate to Actuals page
- [ ] Find unsigned actuals for employee
- [ ] Proxy sign with reason → creates approval instance
- [ ] Navigate to Approvals page
- [ ] Verify approval instance appears in inbox
- [ ] Approve Step 1 (RO) → status remains "pending" (Director step pending)
- [ ] Verify approval shows both RO and Director steps

#### 6. Director Role - Approvals
- [ ] Login as Director
- [ ] Navigate to Approvals page
- [ ] Verify approval from Step 5 appears in inbox
- [ ] Approve Step 2 (Director) → status changes to "approved"
- [ ] Test skip rule: if RO==Director, verify Director step is skipped and RO approval completes workflow

#### 7. Finance Role - Consolidation & Publish
- [ ] Login as Finance
- [ ] Navigate to Consolidation page
- [ ] View dashboard showing demand vs supply gaps
- [ ] Publish snapshot → creates immutable snapshot
- [ ] Verify snapshot lines remain stable (read-only)

#### 8. Error Handling
- [ ] Test invalid FTE (e.g., 42) → shows FTE_INVALID error
- [ ] Test locked period edit → shows PERIOD_LOCKED error
- [ ] Test unauthorized role action → shows UNAUTHORIZED_ROLE error
- [ ] Verify all errors show Problem Details format (code + message), not generic "Failed to fetch"

#### 9. Multi-tenancy
- [ ] Login as user in tenant-001
- [ ] Create data (demand, supply, actuals)
- [ ] Switch to tenant-002 (via Dev Login)
- [ ] Verify no data from tenant-001 is visible

## API Documentation

Once the backend is running:
- Swagger UI: http://localhost:8000/docs
- Health check: http://localhost:8000/healthz

## Environment Variables

See `api/env.example.txt` and `frontend/env.example.txt` for required environment variables.

## License

Proprietary - Internal use only
