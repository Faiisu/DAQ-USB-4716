#!/bin/bash
# See: docs/architecture/context.md
# English comments only

PORTAL_PID_FILE=".portal.pid"
DAQ_PID_FILE=".daq.pid"

# Safeguard check to prevent starting duplicate instances
if [ -f "$PORTAL_PID_FILE" ] || [ -f "$DAQ_PID_FILE" ]; then
    echo "[SYSTEM] Warning: PID files detected. Services may already be running."
    echo "[SYSTEM] Please run ./stop.sh before starting again."
    exit 1
fi

echo "=========================================================="
echo "         MDDP Ingestion Control Suite Startup"
echo "=========================================================="

# 1. Start Main Portal Gateway (Port 8080)
echo "[SYSTEM] Starting Ingestion Portal on http://localhost:8080..."
python3 -m http.server 8080 --directory web >/dev/null 2>&1 &
echo $! > "$PORTAL_PID_FILE"

# 2. Start DAQ USB-4716 Control Panel (Port 8081)
echo "[SYSTEM] Starting DAQ Control Panel on http://localhost:8081..."
python3 USB4716/web_gui.py >/dev/null 2>&1 &
echo $! > "$DAQ_PID_FILE"

echo "[SYSTEM] Services launched in background."
echo "=========================================================="
