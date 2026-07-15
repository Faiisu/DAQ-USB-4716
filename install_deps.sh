#!/bin/bash
# See: docs/architecture/context.md
# English comments only

echo "=========================================================="
echo "         MDDP Ingestion Suite - Installing Dependencies"
echo "=========================================================="

# 1. Detect Python executable
PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo "[ERROR] Python was not found on this system. Please install Python first."
    exit 1
fi

echo "[SYSTEM] Detected Python executable: $PYTHON_CMD ($($PYTHON_CMD --version 2>&1))"

# 2. Set up virtual environment
VENV_DIR="venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "[SYSTEM] Creating Python virtual environment in ./${VENV_DIR}..."
    $PYTHON_CMD -m venv $VENV_DIR
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create virtual environment."
        exit 1
    fi
    echo "[SYSTEM] Virtual environment created."
else
    echo "[SYSTEM] Existing virtual environment found in ./${VENV_DIR}."
fi

# 3. Activate Virtual Environment dynamically based on OS/shell
echo "[SYSTEM] Activating virtual environment..."
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows Git Bash shell
    source "$VENV_DIR/Scripts/activate"
else
    # Linux / macOS shell
    source "$VENV_DIR/bin/activate"
fi

# 4. Upgrade pip and install packages
echo "[SYSTEM] Upgrading pip..."
python -m pip install --upgrade pip

echo "[SYSTEM] Installing dependencies from USB4716/requirements.txt..."
python -m pip install -r USB4716/requirements.txt

if [ $? -eq 0 ]; then
    echo "=========================================================="
    echo "[SUCCESS] All dependencies installed successfully."
    echo "[SYSTEM] To start the background services, run: ./run.sh"
    echo "=========================================================="
else
    echo "=========================================================="
    echo "[ERROR] Failed to install dependencies."
    echo "=========================================================="
    exit 1
fi
