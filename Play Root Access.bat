@echo off
title Root Access - keep this window open while you play
cd /d "%~dp0"
echo.
echo   ROOT ACCESS is starting at http://localhost:8000
echo   Keep this window open while you play. Close it to stop the game.
echo.
rem Open the browser a moment after the server starts.
if not defined RA_NO_BROWSER start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8000'"
where python >nul 2>nul && (python -m http.server 8000) || (py -m http.server 8000)
if errorlevel 1 (
  echo.
  echo   Could not start the server. Python is needed: https://www.python.org/downloads/
  pause
)
