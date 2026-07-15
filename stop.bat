@echo off
rem See: docs/architecture/context.md
rem English comments only

echo ==========================================================
echo          MDDP Ingestion Control Suite Shutdown
echo ==========================================================

rem Kill the background window processes by matching their unique titles
echo [SYSTEM] Stopping Ingestion Portal...
taskkill /fi "WINDOWTITLE eq MDDP_PORTAL_HUB*" /t /f >nul 2>&1

echo [SYSTEM] Stopping DAQ Control Panel...
taskkill /fi "WINDOWTITLE eq MDDP_DAQ_PANEL*" /t /f >nul 2>&1

echo [SYSTEM] Stopping Telemetry Visualizer...
taskkill /fi "WINDOWTITLE eq MDDP_PLOTTER_SERVICE*" /t /f >nul 2>&1

echo [SYSTEM] All background processes stopped.
echo ==========================================================
