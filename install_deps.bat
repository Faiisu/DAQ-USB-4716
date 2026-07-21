@echo off
setlocal EnableDelayedExpansion
rem See: docs/architecture/context.md
rem English comments only

echo ==========================================================
echo          MDDP Ingestion Suite - Installing Dependencies
echo ==========================================================

rem 1. Detect Python executable
rem    We must validate that the found executable actually works, because
rem    Windows 10/11 ships "App Execution Alias" stubs for python.exe that
rem    redirect to the Microsoft Store instead of running Python.
set "PYTHON_CMD="

rem Try "python" first
where python >nul 2>nul
if %errorlevel% equ 0 (
    for /f "delims=" %%i in ('python --version 2^>^&1') do set "_PY_CHECK=%%i"
    echo %_PY_CHECK% | findstr /i "Python" >nul 2>nul
    if !errorlevel! equ 0 (
        set "PYTHON_CMD=python"
    )
)

rem Try "python3" if not found yet
if not defined PYTHON_CMD (
    where python3 >nul 2>nul
    if %errorlevel% equ 0 (
        for /f "delims=" %%i in ('python3 --version 2^>^&1') do set "_PY_CHECK=%%i"
        echo %_PY_CHECK% | findstr /i "Python" >nul 2>nul
        if !errorlevel! equ 0 (
            set "PYTHON_CMD=python3"
        )
    )
)

rem Try "py" launcher as last resort
if not defined PYTHON_CMD (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        for /f "delims=" %%i in ('py --version 2^>^&1') do set "_PY_CHECK=%%i"
        echo %_PY_CHECK% | findstr /i "Python" >nul 2>nul
        if !errorlevel! equ 0 (
            set "PYTHON_CMD=py"
        )
    )
)

if not defined PYTHON_CMD (
    echo [ERROR] Python was not found on this system.
    echo [ERROR] Please install Python 3.9+ from https://www.python.org/downloads/
    echo [ERROR] During installation, check "Add Python to PATH".
    echo [ERROR] Also disable the Windows Store alias stubs:
    echo [ERROR]   Settings ^> Apps ^> Advanced app settings ^> App execution aliases
    echo [ERROR]   Turn OFF "python.exe" and "python3.exe"
    exit /b 1
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
%PYTHON_CMD% -m pip install --upgrade pip

echo [SYSTEM] Installing dependencies from requirements.txt...
%PYTHON_CMD% -m pip install -r requirements.txt

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
