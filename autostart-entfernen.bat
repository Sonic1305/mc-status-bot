@echo off
set "BOT_LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Minecraft Status-Bot.lnk"
if exist "%BOT_LINK%" (
  del "%BOT_LINK%"
  echo Autostart entfernt.
) else (
  echo Es war kein Autostart eingerichtet.
)
pause
