# Requires Administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Administrator privileges required. Attempting to elevate..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Remove Tasks
if (Get-ScheduledTask -TaskName "MDDP_StartServices" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "MDDP_StartServices" -Confirm:$false
    Write-Host "Removed task: MDDP_StartServices"
} else {
    Write-Host "Task MDDP_StartServices not found."
}

if (Get-ScheduledTask -TaskName "MDDP_Watchdog" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "MDDP_Watchdog" -Confirm:$false
    Write-Host "Removed task: MDDP_Watchdog"
} else {
    Write-Host "Task MDDP_Watchdog not found."
}

# Run stop.bat
$stopBatPath = Join-Path $projectDir "stop.bat"
if (Test-Path $stopBatPath) {
    Write-Host "Running stop.bat to stop services..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$stopBatPath`"" -Wait
} else {
    Write-Warning "stop.bat not found at $stopBatPath"
}

Write-Host "Removal complete."
Start-Sleep -Seconds 3
