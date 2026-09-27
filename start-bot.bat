@echo off
title Minecraft Status-Bot
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install Node.js first, see README.md.
  pause
  exit /b 1
)
if not exist ".env" (
  echo [ERROR] No .env found. Please run install.bat first and fill in the .env.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [ERROR] Dependencies are missing. Please run install.bat first.
  pause
  exit /b 1
)

:loop
rem Take over a new version of this file from an update. The block is read
rem completely before the file is replaced; the new version then starts in a
rem new window and this window closes.
if exist "start-bot.bat.new" (
  move /y "start-bot.bat.new" "start-bot.bat" >nul
  start "Minecraft Status-Bot" /min cmd /c "%~f0"
  exit
)

node --env-file=.env src\index.js
set "CODE=%errorlevel%"

rem Code 3 = an update was installed, start the new version right away
if "%CODE%"=="3" (
  echo.
  echo Update installed - starting the new version ...
  goto loop
)

rem The new version crashed before reporting itself healthy: roll back
if exist "update\pending-healthcheck.json" if not "%CODE%"=="0" (
  echo.
  echo The new version crashed on start, code %CODE%. Restoring the previous version ...
  if exist "update\rollback.bat" call "update\rollback.bat"
  if exist "update\pending-healthcheck.json" del /q "update\pending-healthcheck.json"
  timeout /t 5 /nobreak >nul
  goto loop
)

if "%CODE%"=="0" goto :eof
if "%CODE%"=="2" (
  echo.
  echo Configuration error - please read the message above and fix the .env.
  pause
  goto :eof
)
echo.
echo The bot stopped unexpectedly, code %CODE%. Restarting in 15 seconds ...
echo To stop it, simply close this window.
timeout /t 15 /nobreak >nul
goto loop
