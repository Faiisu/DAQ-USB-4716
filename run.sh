#!/bin/bash
# See: docs/architecture/context.md
# English comments only

# Set trap to kill background processes on Ctrl+C (SIGINT / SIGTERM)
trap cleanup EXIT INT TERM

cleanup() {
    echo ""
    echo "[SYSTEM] Shutting down background processes..."
    if [ ! -z "$PORTAL_PID" ]; then
        kill "$PORTAL_PID" 2>/dev/null
    fi
    if [ ! -z "$DAQ_PID" ]; then
        kill "$DAQ_PID" 2>/dev/null
    fi
    echo "[SYSTEM] All services stopped."
}

echo "=========================================================="
echo "         MDDP Ingestion Control Suite Startup"
echo "=========================================================="

# 1. Start Main Portal Gateway (Port 8080)
echo "[SYSTEM] Starting Ingestion Portal on http://localhost:8080..."
python3 -m http.server 8080 --directory web >/dev/null 2>&1 &
PORTAL_PID=$!

# 2. Start DAQ USB-4716 Control Panel (Port 8081)
echo "[SYSTEM] Starting DAQ Control Panel on http://localhost:8081..."
python3 USB4716/web_gui.py &
DAQ_PID=$!

echo "[SYSTEM] Services initialized. Press Ctrl+C to terminate."
echo "=========================================================="

# Wait for background processes to keep script running
wait $DAQ_PID $PORTAL_PID
