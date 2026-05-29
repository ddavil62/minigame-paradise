@echo off
REM ============================================================
REM  Yutnori - server stopper
REM  - Kills the PID that is LISTENING on port 3000~3010.
REM  - Other node.exe processes for other projects are NOT affected
REM    individually, but note: tetris-battle also uses 3000~3010.
REM    If both are running, prefer Ctrl+C in the Yutnori server window.
REM  ASCII-only on purpose (cmd.exe encoding safety).
REM ============================================================

chcp 65001 >nul
setlocal enabledelayedexpansion

REM Yutnori window title (must match start.bat) -- used to scope kill.
set "WIN_TITLE=Yutnori Server"

REM Preferred approach: close the Yutnori console window directly so we do not
REM accidentally kill the tetris-battle/matgo servers also on 3000~3010.
echo [stop.bat] Closing window "%WIN_TITLE%" (if running)...
taskkill /FI "WINDOWTITLE eq %WIN_TITLE%*" /F >nul 2>nul

REM Brief pause so the user can read the result before the window closes.
timeout /t 1 /nobreak >nul
echo [stop.bat] Done. If the server window is still open, press Ctrl+C in it.
timeout /t 1 /nobreak >nul
endlocal
exit /b 0
