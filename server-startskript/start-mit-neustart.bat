@echo off
rem =====================================================================
rem  Minecraft-Server mit automatischem Neustart
rem
rem  Diese Datei gehoert in den SERVER-Ordner (neben run.bat) und ersetzt
rem  run.bat zum Starten. Beendet sich der Server - durch den Discord-Befehl
rem  /server neustart, durch /stop im Spiel oder durch einen Absturz -,
rem  wird er nach 15 Sekunden automatisch neu gestartet.
rem
rem  Server dauerhaft AUS lassen: nach dem Herunterfahren innerhalb der
rem  15 Sekunden N druecken (oder das Fenster schliessen).
rem
rem  Stuerzt der Server 3x hintereinander in den ersten 5 Minuten ab,
rem  wird nicht weiter neu gestartet (Schutz vor Endlosschleife).
rem =====================================================================
title Minecraft-Server (mit Auto-Neustart)
cd /d "%~dp0"
set "QUICK_EXITS=0"

:loop
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "STARTED=%%t"
echo.
echo [%date% %time%] Starte Server ...
echo.

rem --- Diese Zeile muss der java-Zeile aus run.bat entsprechen ---
java @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.250/win_args.txt nogui %*

set "EXIT_CODE=%errorlevel%"
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "ENDED=%%t"
set /a RUNTIME=ENDED-STARTED
echo.
echo [%date% %time%] Server wurde beendet (Code %EXIT_CODE%, Laufzeit %RUNTIME% s).

if %RUNTIME% LSS 300 (set /a QUICK_EXITS+=1) else (set "QUICK_EXITS=0")
if %QUICK_EXITS% GEQ 3 goto crashloop

echo.
choice /c JN /t 15 /d J /m "Server in 15 Sekunden neu starten? J = sofort neu starten, N = aus lassen"
if errorlevel 2 goto off
goto loop

:crashloop
echo.
echo Der Server hat sich 3x hintereinander kurz nach dem Start beendet.
echo Automatischer Neustart gestoppt - bitte die Logs pruefen (logs\latest.log, crash-reports\).
pause
goto :eof

:off
echo.
echo Server bleibt aus.
pause
