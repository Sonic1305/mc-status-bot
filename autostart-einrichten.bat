@echo off
rem Legt eine Verknuepfung im Autostart-Ordner an: Der Bot startet dann bei jeder
rem Windows-Anmeldung automatisch in einem minimierten Fenster.
cd /d "%~dp0"
set "BOT_TARGET=%~dp0start-bot.bat"
set "BOT_DIR=%~dp0"
set "BOT_LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Minecraft Status-Bot.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:BOT_LINK); $s.TargetPath = $env:BOT_TARGET; $s.WorkingDirectory = $env:BOT_DIR; $s.WindowStyle = 7; $s.Description = 'Minecraft Status-Bot'; $s.Save()"
if errorlevel 1 (
  echo [FEHLER] Verknuepfung konnte nicht angelegt werden.
  pause
  exit /b 1
)

echo Autostart eingerichtet: Der Bot startet ab jetzt bei jeder Windows-Anmeldung minimiert.
echo Entfernen mit autostart-entfernen.bat
pause
