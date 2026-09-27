# Upgrading

🇬🇧 English · [🇩🇪 Deutsch](UPGRADE.de.md)

## 1.2 → 1.3 (automatic)

Nothing to do – the bot installs 1.3 by itself. Your `.env` keeps working unchanged:

- **Language:** 1.3 speaks English by default, but installations from before 1.3 **stay German** (remembered in `state.json`). `LANGUAGE="en"` in `.env` switches to English.
- **Restart script:** such installations also keep `start-mit-neustart.bat` as the expected script name. New installs use `server-script/start-with-restart.bat`.
- `RADMIN_NETWORK` / `RADMIN_PASSWORD` keep working (new generic names: `VPN_NETWORK` / `VPN_PASSWORD` / `VPN_NAME`).
- The helper scripts got English names: `autostart-enable.bat`, `autostart-disable.bat`, `block-rcon-firewall.bat`. An existing autostart shortcut or firewall rule keeps working.
- New optional settings (display parts, alert types, admin roles, TPS for Paper/Forge/vanilla, …): see [`.env.example`](.env.example) and `/mc bot info`.

## 1.0 / 1.1 → 1.2 (one-time, manual)

From version 1.2 on the bot updates itself. Hosts running an older version need this one manual upgrade.

### For the host

1. Put the zip `mc-status-bot-v1.2.x.zip` into the **bot folder** (where `start-bot.bat` and `.env` are).
2. Open Claude Code there and say: **"Read UPGRADE.md from the zip and apply the upgrade."**

`.env` and `state.json` are kept. New: the bot then installs new versions from GitHub automatically – say so if you don't want that.

### For Claude

**Rules:** never print secrets from `.env`; don't overwrite `.env` or `state.json`; don't stop/restart the Minecraft server without explicit OK; don't change code in `src/`. The only allowed `.env` change is appending `AUTO_UPDATE=false`.

1. **Check:** `start-bot.bat`, `src\index.js` and `.env` exist in the current folder (`$bot`). Current version is in `package.json`.
2. **Consent:** explain in two sentences that the bot will install new versions from GitHub automatically (the owner's code runs on this PC). If the user declines, append `AUTO_UPDATE=false` to `.env` (UTF-8 without BOM).
3. **Stop the bot** – `start-bot.bat` gets replaced, so it must not be running. Best: ask the user to close the "Minecraft Status-Bot" window. Otherwise stop the start window first, then the bot:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | ? { $_.CommandLine -like '*start-bot.bat*' } | % { Stop-Process -Id $_.ProcessId -Force }
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*src*index.js*' } | % { Stop-Process -Id $_.ProcessId -Force }
   ```
4. **Install** (the zip has no subfolder):
   ```powershell
   Expand-Archive -Path (Get-ChildItem "$bot\mc-status-bot-v*.zip" | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -DestinationPath $bot -Force
   npm install --omit=dev --no-audit --no-fund
   npm test          # must end with "# fail 0"
   New-Item -ItemType Directory -Force "$bot\update"; Copy-Item "$bot\release-manifest.json" "$bot\update\installed-manifest.json" -Force
   ```
   `package.json` must now show version 1.2.1 or higher and `src\updater.js` must exist.
5. **Restart script:** if the server folder has no restart script yet, set it up as in [INSTALL.md](INSTALL.md), step 7.
6. **Start:** `Start-Process -FilePath "$bot\start-bot.bat" -WorkingDirectory $bot -WindowStyle Minimized`. After ~20 s `logs\bot.log` should show the new version, `Bei Discord angemeldet`, `Auto-Update aktiv` (or `ausgeschaltet`) and the server status.
7. **Report back:** installed version, test result, auto-update on/off, restart script status.
