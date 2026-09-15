@echo off
REM ============================================================
REM Setup Scheduled Task - Temp File Cleanup (Windows)
REM Jalankan sekali sebagai Administrator
REM ============================================================

set APP_DIR=%~dp0..
set NODE_BIN=node
set SCRIPT=%APP_DIR%\script\tempCleanup.js
LOG_FILE=%APP_DIR%\logs\cron-cleanup.log
TASK_NAME=SaasGateway_TempCleanup

REM Buat logs folder
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"

REM Hapus task lama jika ada
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

REM Buat task baru: every 1 minute
schtasks /Create /TN "%TASK_NAME%" /TR "\"%NODE_BIN%\" \"%SCRIPT%\"" /SC MINUTE /MO 1 /F

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =========================================
    echo   Temp Cleanup Scheduled Task Created
    echo =========================================
    echo   Task Name : %TASK_NAME%
    echo   Schedule  : Every 1 minute
    echo   Script    : %SCRIPT%
    echo   Log       : %LOG_FILE%
    echo   Max Age   : 40 seconds
    echo =========================================
    echo.
    echo Commands:
    echo   Lihat task  : schtasks /Query /TN "%TASK_NAME%"
    echo   Hapus task  : schtasks /Delete /TN "%TASK_NAME%" /F
    echo   Test manual : node "%SCRIPT%"
) else (
    echo [ERROR] Gagal membuat scheduled task. Jalankan sebagai Administrator.
)

pause
