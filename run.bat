@echo off
SETLOCAL EnableDelayedExpansion

:: --- Configuration ---
SET "DEFAULT_PORT=3000"
SET "ENV_FILE=.env"

:: --- Try to extract PORT from .env ---
IF EXIST "%ENV_FILE%" (
    FOR /F "tokens=1,2 delims==" %%A IN ('findstr /I "PORT=" %ENV_FILE%') DO (
        IF /I "%%A"=="PORT" SET "PORT=%%B"
    )
)

IF "%PORT%"=="" (
    SET "PORT=%DEFAULT_PORT%"
    echo [INFO] No PORT found in .env, using default: %DEFAULT_PORT%
) ELSE (
    echo [INFO] Detected PORT from .env: %PORT%
)

:: --- Kill previous instance on the detected port ---
echo [SYSTEM] Checking for existing processes on port %PORT%...
FOR /F "tokens=5" %%P IN ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') DO (
    echo [CLEANUP] Found process PID %%P using port %PORT%. Killing it...
    taskkill /F /PID %%P >nul 2>&1
    IF !ERRORLEVEL! EQU 0 (
        echo [CLEANUP] Successfully terminated previous instance.
    ) ELSE (
        echo [WARNING] Could not kill process %%P. It might already be closed.
    )
)

:: --- Clean up any dangling node processes (Optional, safety check) ---
:: taskkill /F /IM node.exe /T >nul 2>&1

:: --- Start the Application ---
echo [START] Launching SSC Prep Tracker...
echo [INFO] Press Ctrl+C to stop the server.
echo.

npm start

PAUSE
