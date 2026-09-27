@echo off
rem Blocks the RCON port for access from other computers (including VPNs such as Radmin).
rem The bot connects locally via 127.0.0.1 - the Windows firewall does not block that.
rem Must be run as administrator (right-click -> Run as administrator).
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please right-click and choose "Run as administrator".
  pause
  exit /b 1
)

set "PORT=25575"
if exist ".env" (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"RCON_PORT=" ".env"') do set "PORT=%%~b"
)

set "RULE=Block Minecraft RCON from outside"
rem Name used by older versions of this script
netsh advfirewall firewall delete rule name="Minecraft RCON von aussen sperren" >nul 2>&1
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE%" dir=in action=block protocol=TCP localport=%PORT%
if errorlevel 1 (
  echo [ERROR] The rule could not be created.
  pause
  exit /b 1
)

echo.
echo Done: TCP port %PORT% is now blocked from outside.
echo To undo:  netsh advfirewall firewall delete rule name="%RULE%"
pause
