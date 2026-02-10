# Start Backend Server
# Usage: .\scripts\start-backend.ps1

Write-Host "Starting Backend Server...`n" -ForegroundColor Cyan

# Get script directory and repo root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

# Change to repo root
Set-Location $repoRoot

# Set environment variables
$env:PYTHONPATH = $repoRoot
$env:ENV = "dev"
$env:DEV_AUTH_BYPASS = "true"
$env:DATABASE_URL = "sqlite:///./api/dev.db"

Write-Host "Environment:" -ForegroundColor Yellow
Write-Host "  PYTHONPATH: $env:PYTHONPATH"
Write-Host "  ENV: $env:ENV"
Write-Host "  DEV_AUTH_BYPASS: $env:DEV_AUTH_BYPASS"
Write-Host "  DATABASE_URL: $env:DATABASE_URL"
Write-Host ""

# Check if venv exists
if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "❌ Error: Virtual environment not found at venv\Scripts\python.exe" -ForegroundColor Red
    Write-Host "   Run: python -m venv venv" -ForegroundColor Yellow
    exit 1
}

# Check if port 8000 is in use
$portInUse = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "⚠️  Port 8000 is already in use" -ForegroundColor Yellow
    Write-Host "   Stopping existing process..." -ForegroundColor Yellow
    $portInUse | ForEach-Object {
        $pid = $_.OwningProcess
        if ($pid -ne 0) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
}

# Start backend server
Write-Host "Starting uvicorn server...`n" -ForegroundColor Green
& "venv\Scripts\python.exe" -m uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
