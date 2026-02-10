# Start Frontend Dev Server
# Usage: .\scripts\start-frontend.ps1

Write-Host "Starting Frontend Dev Server...`n" -ForegroundColor Cyan

# Get script directory and repo root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$frontendDir = Join-Path $repoRoot "frontend"

# Change to frontend directory
Set-Location $frontendDir

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠️  node_modules not found. Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Check if port 5173 is in use
$portInUse = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "⚠️  Port 5173 is already in use" -ForegroundColor Yellow
    Write-Host "   Stopping existing process..." -ForegroundColor Yellow
    $portInUse | ForEach-Object {
        $pid = $_.OwningProcess
        if ($pid -ne 0) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
}

# Start frontend dev server
Write-Host "Starting Vite dev server...`n" -ForegroundColor Green
npm run dev
