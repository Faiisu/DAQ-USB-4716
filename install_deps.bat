@echo off
rem See: docs/architecture/context.md
rem English comments only

echo ==========================================================
echo          MDDP Ingestion Suite - Installing Dependencies
echo ==========================================================

rem 1. Detect Python executable
set "PYTHON_CMD="
where python >nul 2>nul
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python"
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYTHON_CMD=py"
    ) else (
        echo [ERROR] Python was not found on this system. Please install Python first.
        exit /b 1
    )
)

for /f "delims=" %%i in ('%PYTHON_CMD% --version 2^>^&1') do set "PYTHON_VER=%%i"
echo [SYSTEM] Detected Python executable: %PYTHON_CMD% (%PYTHON_VER%)

rem 2. Set up virtual environment
set "VENV_DIR=venv"
if not exist "%VENV_DIR%" (
    echo [SYSTEM] Creating Python virtual environment in .\%VENV_DIR%...
    %PYTHON_CMD% -m venv %VENV_DIR%
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        exit /b 1
    )
    echo [SYSTEM] Virtual environment created.
) else (
    echo [SYSTEM] Existing virtual environment found in .\%VENV_DIR%.
)

rem 3. Activate Virtual Environment
echo [SYSTEM] Activating virtual environment...
if exist "%VENV_DIR%\Scripts\activate.bat" (
    call "%VENV_DIR%\Scripts\activate.bat"
) else (
    echo [ERROR] Virtual environment activation script not found.
    exit /b 1
)

rem 4. Upgrade pip and install packages
echo [SYSTEM] Upgrading pip...
python -m pip install --upgrade pip

echo [SYSTEM] Installing dependencies from requirements.txt...
python -m pip install -r requirements.txt

if %errorlevel% equ 0 (
    echo ==========================================================
    echo [SUCCESS] All dependencies installed successfully.
    echo [SYSTEM] To start the background services, run: run.bat
    echo ==========================================================
) else (
    echo ==========================================================
    echo [ERROR] Failed to install dependencies.
    echo ==========================================================
    exit /b 1
)
