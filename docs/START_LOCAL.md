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
$env:PYTHONPATH = "C:\Users\pawel\Documents\GitHub\ResourceAllocation"
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
```

### Frontend (`frontend/.env.local`)
```env
VITE_API_BASE_URL=http://localhost:8000
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
