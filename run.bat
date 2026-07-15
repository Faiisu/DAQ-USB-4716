@echo off
rem See: docs/architecture/context.md
rem English comments only

echo ==========================================================
echo          MDDP Ingestion Control Suite Startup
echo ==========================================================

rem 1. Start Main Portal Gateway (Port 8080)
echo [SYSTEM] Starting Ingestion Portal on http://localhost:8080...
start "MDDP_PORTAL_HUB" /min python -m http.server 8080 --directory web

rem 2. Start DAQ USB-4716 Control Panel (Port 8081)
echo [SYSTEM] Starting DAQ Control Panel on http://localhost:8081...
start "MDDP_DAQ_PANEL" /min python USB4716/web_gui.py

echo [SYSTEM] Services launched in background.
echo ==========================================================
