@echo off
rem Creates a shortcut in the Startup folder: the bot then starts automatically
rem in a minimized window every time you log in to Windows.
cd /d "%~dp0"
set "BOT_TARGET=%~dp0start-bot.bat"
set "BOT_DIR=%~dp0"
set "BOT_LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Minecraft Status-Bot.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:BOT_LINK); $s.TargetPath = $env:BOT_TARGET; $s.WorkingDirectory = $env:BOT_DIR; $s.WindowStyle = 7; $s.Description = 'Minecraft Status-Bot'; $s.Save()"
if errorlevel 1 (
  echo [ERROR] The shortcut could not be created.
  pause
  exit /b 1
)

echo Autostart enabled: the bot now starts minimized every time you log in to Windows.
echo Remove it with autostart-disable.bat
pause
