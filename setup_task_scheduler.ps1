# Requires Administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Administrator privileges required. Attempting to elevate..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Project directory: $projectDir"

# Task 1: MDDP_StartServices
$startAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$projectDir\run.bat`"" -WorkingDirectory $projectDir
$startTrigger = New-ScheduledTaskTrigger -AtStartup
$startPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$startSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0

Register-ScheduledTask -TaskName "MDDP_StartServices" -Action $startAction -Trigger $startTrigger -Principal $startPrincipal -Settings $startSettings -Force
Write-Host "Created task: MDDP_StartServices"

# Task 2: MDDP_Watchdog
$watchdogAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$projectDir\watchdog.ps1`"" -WorkingDirectory $projectDir
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$watchdogPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$watchdogSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit 0

Register-ScheduledTask -TaskName "MDDP_Watchdog" -Action $watchdogAction -Trigger $watchdogTrigger -Principal $watchdogPrincipal -Settings $watchdogSettings -Force
Write-Host "Created task: MDDP_Watchdog"

Write-Host "Setup complete."
Start-Sleep -Seconds 3
