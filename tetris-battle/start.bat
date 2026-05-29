@echo off
REM ============================================================
REM  Tetris Battle - LAN 1:1 server launcher
REM  - Launches "node server.js" in a NEW console window.
REM  - Waits ~2 seconds then opens http://localhost:3000 in the
REM    default browser of the host PC.
REM  - To stop: press Ctrl+C in the server window, or run stop.bat.
REM  ASCII-only on purpose (cmd.exe encoding safety).
REM ============================================================

REM Set console code page to UTF-8 so Korean server logs render correctly.
chcp 65001 >nul

REM Move into the folder where this .bat lives (tetris-battle/).
cd /d "%~dp0"

REM Verify Node.js is installed.
where node >nul 2>nul
if errorlevel 1 (
  echo [start.bat] Node.js not found. Install Node.js 18+ first ^(https://nodejs.org^).
  pause
  exit /b 1
)

REM Launch the server in a NEW console window so logs are visible.
REM Window title: "Tetris Battle Server".
start "Tetris Battle Server" cmd /k "chcp 65001 >nul && node server.js"

REM Wait for the server to boot (Express + ws listen usually < 1s).
timeout /t 2 /nobreak >nul

REM Open the host browser to the local URL (uses default browser).
start "" http://localhost:3000

REM Friend-PC URL is printed inside the new server console window (LAN box).
echo.
echo [start.bat] Server started in a new window.
echo [start.bat] Host browser: http://localhost:3000
echo [start.bat] Friend PC URL: see the server console window.
echo [start.bat] Stop: run stop.bat or press Ctrl+C in the server window.
echo.

REM This window only prints info; the server keeps running in its own window.
exit /b 0
