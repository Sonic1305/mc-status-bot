@echo off
rem Sperrt den RCON-Port fuer Zugriffe von anderen Rechnern (auch aus dem Radmin-Netz).
rem Der Bot verbindet sich lokal ueber 127.0.0.1 - das blockiert die Windows-Firewall nicht.
rem Muss als Administrator ausgefuehrt werden (Rechtsklick -> Als Administrator ausfuehren).
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] Bitte per Rechtsklick "Als Administrator ausfuehren".
  pause
  exit /b 1
)

set "PORT=25575"
if exist ".env" (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"RCON_PORT=" ".env"') do set "PORT=%%~b"
)

set "RULE=Minecraft RCON von aussen sperren"
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE%" dir=in action=block protocol=TCP localport=%PORT%
if errorlevel 1 (
  echo [FEHLER] Regel konnte nicht angelegt werden.
  pause
  exit /b 1
)

echo.
echo Fertig: TCP-Port %PORT% ist jetzt von aussen gesperrt.
echo Rueckgaengig machen:  netsh advfirewall firewall delete rule name="%RULE%"
pause
