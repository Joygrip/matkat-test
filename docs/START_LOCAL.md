# Starting the App Locally

This guide explains how to start the backend and frontend services for local development.

## Quick Start (Recommended)
 venv\Scripts\Activate.ps1 
### Option 1: Use the Startup Scripts

**Windows PowerShell:**
```powershell
# Start Backend
.\scripts\start-backend.ps1

# Start Frontend (in a separate terminal)
.\scripts\start-frontend.ps1
```

### Option 2: Manual Start

**Terminal 1 - Backend:**
```powershell
cd C:\Users\pawel\Documents\GitHub\ResourceAllocation

# Set environment variables
$env:PYTHONPATH = "C:\Users\pawel\Documents\GitHub\matkat-test"
$env:PYTHONPATH = "C:\VSCode\ResourceAllocation-master"
$env:ENV = "dev"
$env:DEV_AUTH_BYPASS = "true"
$env:DATABASE_URL = "sqlite:///./api/dev.db"

# Start backend
.\venv\Scripts\python.exe -m uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend:**
```powershell
cd C:\Users\pawel\Documents\GitHub\ResourceAllocation\frontend

# Start frontend
npm run dev
```

## What Was Fixed

When the app "broke" after restarting Cursor, the issue was:

1. **Environment variables not set** - The shell session lost the environment variables
2. **Services not started** - Backend and frontend weren't running
3. **Environment files** - Verified `.env` files had correct settings

## Key Environment Variables

The backend needs these environment variables:

- `PYTHONPATH` - Must point to the repo root for imports to work
- `ENV=dev` - Sets the environment to development
- `DEV_AUTH_BYPASS=true` - Enables dev auth bypass for local testing
- `DATABASE_URL` - Points to the SQLite database

## Verification

After starting both services:

1. **Backend**: http://localhost:8000/healthz should return 200
2. **Frontend**: http://localhost:5173 should load the app
3. **API Docs**: http://localhost:8000/docs should show Swagger UI

## Testing actuals in dev

To enter and test actuals locally:

1. Ensure the backend has run at least once (startup auto-seeds example data when `DEV_AUTH_BYPASS=true`), or call **POST /dev/seed** (e.g. from API docs) to create example data.
2. Open the app and use **Dev Login**: choose role **Employee** and pick a resource that has a linked user (e.g. Dev User or Alice Developer), or choose **Admin** to add actuals for any employee.
3. In the app, select an **open period** in the period dropdown (e.g. Feb 2026). Locked periods do not allow new actuals.
4. Go to **Actuals**, click **Add Actual**, select resource (if Admin), project, and FTE %, then **Create**.

## Troubleshooting

### Services won't start

1. **Check if ports are in use:**
   ```powershell
   Get-NetTCPConnection -LocalPort 8000,5173
   ```

2. **Stop existing processes:**
   ```powershell
   # Find and stop backend
   Get-Process python | Where-Object { $_.Path -like "*ResourceAllocation*venv*" } | Stop-Process
   
   # Find and stop frontend (if running on port 5173)
   Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { Stop-Process -Id $_.OwningProcess }
   ```

### Dashboard looks wrong

1. **Hard refresh browser**: Ctrl+Shift+R
2. **Check browser console**: F12 → Console tab
3. **Verify environment files:**
   - `api/.env` should have `DEV_AUTH_BYPASS=true`
   - `frontend/.env.local` should have `VITE_DEV_AUTH_BYPASS=true`

### "Cannot reach API" or HTTP 0 (NETWORK_ERROR)

If the app shows "Cannot reach the API" or requests fail with a network error when adding actuals or calling the API:

1. **Use the Vite proxy in dev (recommended):** When you run `npm run dev`, the frontend defaults to `apiBaseUrl: '/api'`, so requests go to the same origin and Vite proxies them to the backend. **Do not set** `VITE_API_BASE_URL` in `frontend/.env.local` (or leave it unset) so this proxy is used and CORS is avoided.
2. **Backend must be running:** The proxy forwards to `http://localhost:8000`. Start the backend (e.g. `uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000`). You can check `http://localhost:8000/healthz` in a browser.
3. **If you set VITE_API_BASE_URL:** Then the frontend calls the API directly (cross-origin). Ensure CORS allows your origin: the backend allows `http://localhost:5173`, `http://127.0.0.1:5173`. For another origin (e.g. `http://192.168.x.x:5173`), set `ADDITIONAL_CORS_ORIGINS` in `api/.env`.

### Import errors

Make sure `PYTHONPATH` is set to the repo root:
```powershell
$env:PYTHONPATH = "C:\Users\pawel\Documents\GitHub\ResourceAllocation"
```

## Environment Files

### Backend (`api/.env`)
```env
ENV=dev
DEV_AUTH_BYPASS=true
DATABASE_URL=sqlite:///./dev.db
# Optional: if you open the frontend from another host (e.g. http://192.168.1.10:5173), add it here to fix CORS:
# ADDITIONAL_CORS_ORIGINS=http://192.168.1.10:5173
```

### Frontend (`frontend/.env.local`)
```env
# Leave VITE_API_BASE_URL unset in dev so the Vite proxy is used (avoids CORS / HTTP 0 errors).
# VITE_API_BASE_URL=http://localhost:8000
VITE_DEV_AUTH_BYPASS=true
```

## Stopping Services

**Option 1: Close the PowerShell windows** (easiest)

**Option 2: Stop processes:**
```powershell
# Stop backend
Get-Process python | Where-Object { $_.Path -like "*ResourceAllocation*venv*" } | Stop-Process

# Stop frontend
Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```
