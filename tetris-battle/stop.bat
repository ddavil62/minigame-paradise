@echo off
REM ============================================================
REM  Tetris Battle - server stopper
REM  - Kills the PID that is LISTENING on port 3000~3010.
REM  - Other node.exe processes for other projects are NOT affected.
REM  - The fallback range matches MAX_PORT_FALLBACK in server.js.
REM  ASCII-only on purpose (cmd.exe encoding safety).
REM ============================================================

chcp 65001 >nul
setlocal enabledelayedexpansion

set "STOPPED=0"

for %%P in (3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010) do (
  REM netstat -ano output for the matching port. tokens 4=state, 5=PID.
  REM Only LISTENING entries are killed (TIME_WAIT entries are ignored).
  for /f "tokens=4,5" %%A in ('netstat -ano ^| findstr ":%%P "') do (
    if "%%A"=="LISTENING" (
      if not "%%B"=="0" (
        echo [stop.bat] Killing PID %%B on port %%P ...
        taskkill /PID %%B /F >nul 2>nul
        if not errorlevel 1 (
          set "STOPPED=1"
        )
      )
    )
  )
)

if "!STOPPED!"=="0" (
  echo [stop.bat] No Tetris Battle server found on ports 3000~3010.
) else (
  echo [stop.bat] Server stopped.
)

REM Brief pause so the user can read the result before the window closes.
timeout /t 2 /nobreak >nul
endlocal
exit /b 0
