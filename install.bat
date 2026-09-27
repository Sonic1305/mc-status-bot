@echo off
title Minecraft Status-Bot - Installation
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org and then run install.bat again.
  pause
  exit /b 1
)

echo Installing dependencies ...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] Installation failed - see the messages above.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo The file .env was created. Please open it in a text editor now and fill it in.
)

echo.
echo Done. Then start the bot with start-bot.bat.
pause
