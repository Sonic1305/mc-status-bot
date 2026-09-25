# Host installation (with Claude Code)

🇬🇧 English · [🇩🇪 Deutsch](INSTALL.de.md)

## For the host

1. Unzip on the PC that runs the Minecraft server, e.g. to `C:\Gameserver\mc-status-bot`.
2. Put the **`.env`** you received separately into that folder (exact name `.env`, not `.env.txt`).
3. Open Claude Code in the folder and say: **"Read INSTALL.md and set up the bot."**

`.env` contains the bot token and RCON password – never share it. The bot **updates itself** from GitHub when the owner publishes a new version; say so if you don't want that.

---

## For Claude

Set up the finished Discord status bot on this Windows PC. It runs next to the Minecraft server and queries it locally (RCON + status ping). Background: `README.md`.

**Rules**
- Never print secrets (`DISCORD_TOKEN`, `RCON_PASSWORD`, `RADMIN_PASSWORD`). When comparing, only report match / no match.
- Don't change `DISCORD_TOKEN` or code in `src/`.
- Don't stop/restart the Minecraft server or edit `server.properties` without the user's explicit OK – players may be online.
- Don't open firewall ports (the bot only connects outbound).
- Only one instance per token: ask whether the bot runs anywhere else and have it stopped first.

### 1. Prerequisites
- `node -v` must be ≥ 20.6. If missing, ask before running `winget install OpenJS.NodeJS.LTS` (new shell afterwards).
- `.env` must exist (check existence only). If it's missing, ask the user for it – don't create it from `.env.example`.
- Ask for the server folder (contains `server.properties`, `mods/`, `run.bat`).
- Note the IPv4 of the **"Radmin VPN"** adapter from `ipconfig` (starts with `26.`).

### 2. Install and test
```powershell
npm install --omit=dev --no-audit --no-fund
npm test          # must end with "# fail 0"
```

### 3. Match `.env` with the server
```powershell
$server = 'C:\PATH\TO\SERVER'; $bot = 'C:\PATH\TO\mc-status-bot'
function Read-KV($f) { $h=@{}; Get-Content $f | ? { $_ -match '^\s*[^#\s][^=]*=' } | % { $k,$v = $_ -split '=',2; $h[$k.Trim()] = $v.Trim().Trim('"') }; $h }
$p = Read-KV "$server\server.properties"; $e = Read-KV "$bot\.env"
[pscustomobject]@{ 'enable-rcon'=$p['enable-rcon']; 'server-ip'=$p['server-ip']; MC_HOST=$e['MC_HOST']
  'MC_PORT ok'=$e['MC_PORT'] -eq $p['server-port']; 'RCON_PORT ok'=$e['RCON_PORT'] -eq $p['rcon.port']
  'RCON_PASSWORD ok'=$e['RCON_PASSWORD'] -eq $p['rcon.password']; CONNECT_ADDRESS=$e['CONNECT_ADDRESS'] } | Format-List
```
- `enable-rcon` must be `true` – otherwise stop and ask (needs `server.properties` change + server restart).
- `MC_HOST` should be `127.0.0.1` (or the value of `server-ip` if that is set). The owner filled `.env` on another PC, so this change is intended.
- Ports and password: `server.properties` wins.
- `CONNECT_ADDRESS` = `<Radmin IP>:<server-port>`.

Fix values without printing them (saves UTF-8 without BOM):
```powershell
$h = if ([string]::IsNullOrWhiteSpace($p['server-ip'])) { '127.0.0.1' } else { $p['server-ip'] }
$lines = Get-Content "$bot\.env" -Encoding UTF8 | % {
  if ($_ -like 'MC_HOST=*') { "MC_HOST=`"$h`"" } elseif ($_ -like 'RCON_PASSWORD=*') { 'RCON_PASSWORD="' + $p['rcon.password'] + '"' }
  elseif ($_ -like 'RCON_PORT=*') { 'RCON_PORT=' + $p['rcon.port'] } elseif ($_ -like 'MC_PORT=*') { 'MC_PORT=' + $p['server-port'] } else { $_ } }
[IO.File]::WriteAllLines("$bot\.env", [string[]]$lines, (New-Object Text.UTF8Encoding $false))
```

### 4. Auto-update consent
Explain in two sentences that the bot installs new versions from GitHub automatically, i.e. the owner's code runs on this PC. Ask if that's OK.
- **Yes:** `New-Item -ItemType Directory -Force "$bot\update"; Copy-Item "$bot\release-manifest.json" "$bot\update\installed-manifest.json"`
- **No:** append `AUTO_UPDATE=false` to `.env`.

### 5. Test run
Run `node --env-file=.env src/index.js` in the background for ~40 s, read `logs\bot.log`, then stop it. Expect: `Bei Discord angemeldet`, `Bot-Besitzer:`, `Auto-Update aktiv` (or `ausgeschaltet`), `Server ist online`.
- Invite link in the log → give it to the user for the owner.
- `ECONNREFUSED` / `RCON-Passwort ist falsch` → back to step 3.
- `DISCORD_TOKEN ist ungültig` → don't fix; the owner must send a new `.env`.

### 6. Run permanently
```powershell
cmd /c "autostart-einrichten.bat" < nul
Start-Process -FilePath "$bot\start-bot.bat" -WorkingDirectory $bot -WindowStyle Minimized
```
Tell the user: the minimized window "Minecraft Status-Bot" must stay open.

### 7. Restart script (for `/mc server restart`)
Copy `server-startskript\start-mit-neustart.bat` into the server folder (ask before overwriting). Its `java …` line must equal the one in `run.bat` – replace only that line if it differs, keep CRLF line endings. With the user's OK, switch shortcuts/autostart from `run.bat` to it. Tell the user: start the server with this file from now on; press `N` within 15 s after a stop to keep it off. The currently running server switches over at its next restart.

**Scheduled restarts:** check the Windows Task Scheduler for tasks that stop/start the server (`run.bat`, `java`, `taskkill`, `mcrcon`) and show them to the user. A task must no longer *start* the server (the restart script does that – otherwise it starts twice). If the user wants the bot to do the scheduled restarts instead (countdown in game, clean shutdown), disable that task with their OK and set `RESTART_SCHEDULE="HH:MM"` in `.env`.

### 8. Firewall (recommended, user does it)
Ask whether anything on another PC uses RCON. If not, the user runs `rcon-firewall-sperren.bat` via right-click → *Run as administrator*. Afterwards `logs\bot.log` must not show new RCON errors.

### 9. Report back
Node version, bot folder, changed `.env` keys (names only), test and log results, auto-update on/off, autostart, restart script status, firewall rule.
