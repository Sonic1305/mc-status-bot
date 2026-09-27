@echo off
rem =====================================================================
rem  Minecraft server with automatic restart
rem
rem  Put this file into the SERVER folder (next to run.bat) and use it
rem  instead of run.bat to start the server. Whenever the server stops -
rem  through the Discord command /mc server restart, /stop in-game or a
rem  crash - it is started again after 15 seconds.
rem
rem  To keep the server OFF: press N within the 15 seconds after it
rem  stopped (or close the window).
rem
rem  If the server stops 3 times in a row within 5 minutes of starting,
rem  it is not restarted again (protection against an endless loop).
rem =====================================================================
title Minecraft Server (with auto restart)
cd /d "%~dp0"
set "QUICK_EXITS=0"

:loop
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "STARTED=%%t"
echo.
echo [%date% %time%] Starting server ...
echo.

rem --- This line must match the java line from your run.bat (example: NeoForge) ---
java @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.250/win_args.txt nogui %*

set "EXIT_CODE=%errorlevel%"
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "ENDED=%%t"
set /a RUNTIME=ENDED-STARTED
echo.
echo [%date% %time%] Server stopped (code %EXIT_CODE%, ran %RUNTIME% s).

if %RUNTIME% LSS 300 (set /a QUICK_EXITS+=1) else (set "QUICK_EXITS=0")
if %QUICK_EXITS% GEQ 3 goto crashloop

echo.
choice /c YN /t 15 /d Y /m "Restart the server in 15 seconds? Y = restart now, N = keep it off"
if errorlevel 2 goto off
goto loop

:crashloop
echo.
echo The server stopped 3 times in a row shortly after starting.
echo Automatic restart stopped - please check the logs (logs\latest.log, crash-reports\).
pause
goto :eof

:off
echo.
echo The server stays off.
pause
