#!/bin/bash
# See: docs/architecture/context.md
# English comments only

PORTAL_PID_FILE=".portal.pid"
DAQ_PID_FILE=".daq.pid"

echo "=========================================================="
echo "         MDDP Ingestion Control Suite Shutdown"
echo "=========================================================="

# 1. Stop Main Portal Gateway
if [ -f "$PORTAL_PID_FILE" ]; then
    PID=$(cat "$PORTAL_PID_FILE")
    if ps -p "$PID" >/dev/null 2>&1; then
        echo "[SYSTEM] Stopping Ingestion Portal (PID: $PID)..."
        kill "$PID" 2>/dev/null
    else
        echo "[SYSTEM] Ingestion Portal process not found."
    fi
    rm "$PORTAL_PID_FILE"
else
    echo "[SYSTEM] Ingestion Portal is already stopped."
fi

# 2. Stop DAQ Control Panel
if [ -f "$DAQ_PID_FILE" ]; then
    PID=$(cat "$DAQ_PID_FILE")
    if ps -p "$PID" >/dev/null 2>&1; then
        echo "[SYSTEM] Stopping DAQ Control Panel (PID: $PID)..."
        kill "$PID" 2>/dev/null
    else
        echo "[SYSTEM] DAQ Control Panel process not found."
    fi
    rm "$DAQ_PID_FILE"
else
    echo "[SYSTEM] DAQ Control Panel is already stopped."
fi

echo "[SYSTEM] Shutdown sequence completed."
echo "=========================================================="
