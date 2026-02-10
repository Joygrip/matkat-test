# Start Both Backend and Frontend
# Usage: .\scripts\start-all.ps1
# This opens two separate PowerShell windows

Write-Host "Starting Backend and Frontend...`n" -ForegroundColor Cyan

# Get script directory and repo root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

# Start backend in new window
Write-Host "Opening Backend window..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repoRoot'; .\scripts\start-backend.ps1"

# Wait a moment
Start-Sleep -Seconds 2

# Start frontend in new window
Write-Host "Opening Frontend window..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repoRoot'; .\scripts\start-frontend.ps1"

Write-Host "`n✅ Both services starting in separate windows" -ForegroundColor Green
Write-Host "`n📋 URLs:" -ForegroundColor Cyan
Write-Host "   Backend: http://localhost:8000" -ForegroundColor White
Write-Host "   Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "   API Docs: http://localhost:8000/docs" -ForegroundColor White
Write-Host "`n💡 Check the PowerShell windows for any errors" -ForegroundColor Yellow
