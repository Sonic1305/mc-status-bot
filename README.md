# Minecraft Status Bot for Discord

🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

A Discord bot that keeps **one live message** in a channel up to date with the status of your Minecraft server. Built for NeoForge 1.21, works with any server that has RCON.

- 🟢 / 🟡 / 🔴 status, player count and **all player names**, TPS, version, uptime, daily and all-time player record, connection info (e.g. Radmin VPN)
- Bot presence shows the player count in the member list
- Optional alerts: server down (after 10 min) / back up with role ping, new player record
- `/mc server restart`: the bot owner restarts the server from Discord, with an in-game countdown
- Scheduled daily restarts (`RESTART_SCHEDULE`) with in-game countdown – quiet unless something goes wrong
- Updates itself from GitHub releases and rolls back automatically if a new version fails to start

## How it works

The bot runs on the **same PC as the Minecraft server**. Every 15 s it sends `list uuids` and `neoforge tps` via RCON (localhost) and does a status ping. It edits the Discord message only when something changes, plus a heartbeat every 60 s. State (message ID, records) lives in `state.json`, so restarts keep editing the same message.

## Setup (Windows)

Requirements: Node.js 20.6+ ([LTS](https://nodejs.org)), RCON enabled on the server.

1. **Discord bot:** [Developer Portal](https://discord.com/developers/applications) → *New Application* → *Bot* → *Reset Token* and copy it. No privileged intents needed. Keep the token secret.
2. **Install:** copy this folder to the server PC and run `install.bat` (installs dependencies, creates `.env`).
3. **RCON:** in `server.properties` set `enable-rcon=true`, `rcon.port` and a long `rcon.password`, then restart the server.
4. **Configure:** fill in `.env` (see below).
5. **Start:** run `start-bot.bat`. On first start it prints an invite link – open it and add the bot to your Discord server.
6. **In Discord:** `/mc bot status-channel channel:#status` creates the live message. Optional: `/mc bot alerts channel:#alerts role:@Minecraft`. Tip: make the status channel read-only for `@everyone`.
7. **Autostart:** run `autostart-einrichten.bat` (starts the bot minimized at Windows login).
8. **Recommended:** run `rcon-firewall-sperren.bat` as administrator. It blocks the RCON port for other PCs (e.g. everyone in a Radmin VPN network); the bot connects locally and is not affected.
9. **For `/mc server restart`:** copy `server-startskript/start-mit-neustart.bat` into the server folder, make sure its `java …` line matches your `run.bat`, and start the server with it from now on. It restarts the server whenever it stops (press `N` within 15 s to keep it off).

Setting it up on someone else's PC with Claude Code? See [INSTALL.md](INSTALL.md).

## Configuration (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | – | Bot token (required, secret) |
| `MC_HOST` / `MC_PORT` | `127.0.0.1` / `25565` | Minecraft server address |
| `RCON_PORT` / `RCON_PASSWORD` | `25575` / – | From `server.properties`. Empty password = status ping only (max. 12 names, no TPS) |
| `SERVER_NAME`, `VERSION_TEXT` | – | Shown in the message |
| `RADMIN_NETWORK`, `RADMIN_PASSWORD`, `CONNECT_ADDRESS` | – | Connection info shown in the message (leave empty to hide) |
| `SHOW_TPS` | `true` | Show TPS / ms per tick |
| `POLL_INTERVAL_SECONDS` / `HEARTBEAT_SECONDS` | `15` / `60` | Query interval / forced refresh |
| `OFFLINE_AFTER_FAILS` | `3` | Failed queries in a row before "offline" |
| `OFFLINE_ALERT_MINUTES` | `10` | Delay before the "offline" alert (0 = immediately) |
| `OWNER_IDS` | owner of the Discord app | Discord user IDs allowed to use `/server` |
| `RESTART_SCRIPT_NAME` | `start-mit-neustart.bat` | Restart script in the server folder |
| `RESTART_TIMEOUT_MINUTES` / `RESTART_COOLDOWN_MINUTES` | `10` / `5` | Alert if not back / min. gap between restarts |
| `RESTART_KILL_AFTER_MINUTES` | `5` | If the server process still runs this long after `stop` (e.g. a mod error while shutting down), the bot kills exactly that process so the restart script can start it again. `0` = never |
| `RESTART_SCHEDULE` / `RESTART_SCHEDULE_COUNTDOWN_MINUTES` | off / `5` | Daily restart times, e.g. `"04:00,16:00"` (in `TIMEZONE`) / countdown before. Skipped if the server started < 30 min ago or the restart script isn't running. Replaces a Windows Task Scheduler restart – don't use both |
| `AUTO_UPDATE` / `UPDATE_CHECK_HOURS` | `true` / `6` | Install new releases automatically |
| `UPDATE_REPO` | from `package.json` | GitHub repo for updates |
| `TIMEZONE` | `Europe/Berlin` | Day boundary for the daily record |

## Commands

Everything lives under one command, `/mc`: `server` acts on the Minecraft server, `bot` on the Discord bot.

| Command | Who | What |
|---|---|---|
| `/mc status` | everyone | Current status, only visible to you |
| `/mc help` | everyone | Lists the commands you're allowed to use |
| `/mc server restart [countdown:]` | bot owner | Restart the Minecraft server (now / 1 / 5 / 10 min countdown) |
| `/mc server cancel-restart` | bot owner | Cancel a scheduled restart |
| `/mc bot status-channel channel:` | admins | Post the live status message in a channel |
| `/mc bot alerts channel: [role:]` / `alerts-off` | admins | Alerts on / off |
| `/mc bot reset-records` | admins | Reset daily and all-time records |
| `/mc bot info` | admins | Version, settings, RCON state, restart schedule |
| `/mc bot update` | bot owner | Check for and install a new **bot** version now |

Discord can only hide whole commands, so everyone sees all `/mc` subcommands – the bot checks permissions itself: "admins" = *Manage Server* (or the bot owner), "bot owner" = the owner's Discord user ID (roles are not enough).

## Auto-update

Every 6 h (or on `/mc bot update`) the bot fetches the latest GitHub release, verifies every file against the SHA-256 checksums in `release-manifest.json`, backs up the current files to `update/backup/`, installs and restarts itself. If the new version crashes on startup, `start-bot.bat` restores the previous one and skips that version. `.env`, `state.json`, `logs/` and the server folder are never touched.

> ⚠️ Whoever can publish releases in this repo can run code on the host PC. Checksums protect against broken downloads, not against a compromised GitHub account – **enable 2FA**. Hosts who don't want this set `AUTO_UPDATE=false`.

**Publishing a release** (owner, needs `git`, GitHub CLI logged in, clean `main`):

```
npm run release -- 1.3.0 "What's new (shown in Discord)"
```

This runs the tests, bumps the version, writes the manifest, tags, pushes and creates the GitHub release. Don't remove `.gitattributes` – it keeps files byte-identical so the checksums match.

## Troubleshooting

Everything is logged to the console window and `logs/bot.log`.

| Problem | Fix |
|---|---|
| `DISCORD_TOKEN ist ungültig` | Reset the token in the Developer Portal and update `.env` |
| `RCON … ECONNREFUSED` | Server not running, RCON disabled or wrong `RCON_PORT` |
| `RCON-Passwort ist falsch` | `RCON_PASSWORD` must match `rcon.password` exactly |
| Message stays 🟡 | RCON not answering (heavy lag or wrong password) – check `/mc bot info` |
| Slash commands missing | Reload Discord (`Ctrl+R`); re-invite the bot with the link from the console |
| `/mc server restart` warns about the script | The server was started via `run.bat` – start it once via `start-mit-neustart.bat` |
| "Aktualisiert" timestamp is old | Host PC or bot is off (hard power-off can't update the message) |

## Development

```
npm test            # unit tests (parsers, RCON/ping against mock servers, restart, updater)
npm start           # run once without the restart loop
```

`src/index.js` main loop & Discord · `monitor.js` queries · `rcon.js` / `ping.js` protocols · `embed.js` message · `commands.js` slash commands · `restart.js` restart flow · `updater.js` auto-update · `tools/release.js` release script

## License

[MIT](LICENSE)
