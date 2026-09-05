@echo off
title ChatGPT Browser Automation Launcher (Port 9222)
echo ========================================================
echo   ChatGPT Browser Automation - Chrome Launcher (Port 9222)
echo ========================================================
echo.

set PROFILE_DIR=C:\Users\NCN0C\.chrome-automation
if not exist "%PROFILE_DIR%" (
    mkdir "%PROFILE_DIR%"
)

if exist "%PROFILE_DIR%\Default\LOCK" (
    del /f /q "%PROFILE_DIR%\Default\LOCK" 2>nul
)

echo Menjalankan Google Chrome dengan Remote Debugging Port 9222...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding "https://chatgpt.com"

echo.
echo ========================================================
echo [OK] Chrome Automation aktif di port 9222!
echo [OK] Profil Directory: %PROFILE_DIR%
echo ========================================================
echo.
echo LANGKAH SELANJUTNYA:
echo 1. Login ke akun ChatGPT kamu di jendela browser yang terbuka.
echo 2. Login hanya perlu dilakukan 1x (tersimpan permanen).
echo 3. Berikan prompt kamu di chat ini atau jalankan: node generator.js
echo.
pause
