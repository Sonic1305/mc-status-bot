@echo off
title Minecraft Status-Bot - Installation
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] Node.js ist nicht installiert.
  echo Bitte von https://nodejs.org die LTS-Version installieren und danach install.bat erneut starten.
  pause
  exit /b 1
)

echo Installiere Abhaengigkeiten ...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo [FEHLER] Installation fehlgeschlagen - siehe Meldungen oben.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo Die Datei .env wurde angelegt. Bitte jetzt mit dem Editor oeffnen und ausfuellen.
)

echo.
echo Fertig. Danach den Bot mit start-bot.bat starten.
pause
