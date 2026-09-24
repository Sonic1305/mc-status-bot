@echo off
title Minecraft Status-Bot
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] Node.js wurde nicht gefunden. Bitte zuerst Node.js installieren, siehe README.md.
  pause
  exit /b 1
)
if not exist ".env" (
  echo [FEHLER] Keine .env gefunden. Bitte zuerst install.bat ausfuehren und die .env ausfuellen.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [FEHLER] Abhaengigkeiten fehlen. Bitte zuerst install.bat ausfuehren.
  pause
  exit /b 1
)

:loop
rem Neue Fassung dieser Datei aus einem Update uebernehmen. Der Block wird komplett
rem eingelesen, bevor die Datei ersetzt wird; danach startet die neue Fassung in
rem einem neuen Fenster und dieses Fenster schliesst sich.
if exist "start-bot.bat.new" (
  move /y "start-bot.bat.new" "start-bot.bat" >nul
  start "Minecraft Status-Bot" /min cmd /c "%~f0"
  exit
)

node --env-file=.env src\index.js
set "CODE=%errorlevel%"

rem Code 3 = Update wurde installiert, sofort die neue Version starten
if "%CODE%"=="3" (
  echo.
  echo Update installiert - starte die neue Version ...
  goto loop
)

rem Neue Version ist abgestuerzt, bevor sie sich als lauffaehig gemeldet hat: zurueckrollen
if exist "update\pending-healthcheck.json" if not "%CODE%"=="0" (
  echo.
  echo Die neue Version ist beim Start abgestuerzt, Code %CODE%. Stelle die vorherige Version wieder her ...
  if exist "update\rollback.bat" call "update\rollback.bat"
  if exist "update\pending-healthcheck.json" del /q "update\pending-healthcheck.json"
  timeout /t 5 /nobreak >nul
  goto loop
)

if "%CODE%"=="0" goto :eof
if "%CODE%"=="2" (
  echo.
  echo Konfigurationsfehler - bitte die Meldung oben lesen und die .env korrigieren.
  pause
  goto :eof
)
echo.
echo Bot wurde unerwartet beendet, Code %CODE%. Neustart in 15 Sekunden ...
echo Zum Beenden einfach dieses Fenster schliessen.
timeout /t 15 /nobreak >nul
goto loop
