@echo off
REM ============================================================
REM  Yutnori - LAN 1:1 server launcher
REM  - Launches "node server.js" in a NEW console window.
REM  - Waits ~2 seconds then opens http://localhost:3000 in the
REM    default browser of the host PC.
REM  - If port 3000 is busy (e.g. tetris-battle running), server
REM    auto-falls back to 3001, 3002, ... (see server console).
REM  - To stop: press Ctrl+C in the server window, or run stop.bat.
REM  ASCII-only on purpose (cmd.exe encoding safety).
REM ============================================================

REM Set console code page to UTF-8 so Korean server logs render correctly.
chcp 65001 >nul

REM Move into the folder where this .bat lives (yutnori/).
cd /d "%~dp0"

REM Verify Node.js is installed.
where node >nul 2>nul
if errorlevel 1 (
  echo [start.bat] Node.js not found. Install Node.js 18+ first ^(https://nodejs.org^).
  pause
  exit /b 1
)

REM Install dependencies on first run (node_modules missing).
if not exist "node_modules" (
  echo [start.bat] First run: installing dependencies ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [start.bat] npm install failed. Aborting.
    pause
    exit /b 1
  )
)

REM Launch the server in a NEW console window so logs are visible.
REM Window title: "Yutnori Server".
start "Yutnori Server" cmd /k "chcp 65001 >nul && node server.js"

REM Wait for the server to boot.
timeout /t 2 /nobreak >nul

REM Open the host browser to the local URL (uses default browser).
REM Note: if 3000 is busy and server fell back, this localhost link may not
REM       work -- check the server console window for the actual port.
start "" http://localhost:3000

echo.
echo [start.bat] Server started in a new window.
echo [start.bat] Host browser: http://localhost:3000 (or fallback port shown in server console)
echo [start.bat] Friend PC URL: see the server console window.
echo [start.bat] Stop: run stop.bat or press Ctrl+C in the server window.
echo.

exit /b 0
