# Minecraft Status Bot for Discord

🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

A Discord bot that keeps **one live message** in a channel up to date with the status of your Minecraft server. Works with any Java server that has RCON – NeoForge, Forge, Paper/Spigot, Fabric, vanilla. Texts in **English or German** (`LANGUAGE`).

- 🟢 / 🟡 / 🔴 status, player count and **all player names**, TPS, version, uptime, daily and all-time player record, how to connect (address, optional VPN), your own info text – every part can be switched on or off
- Bot presence shows the player count in the member list
- Optional alerts: server down (after 10 min) / back up with role ping, new player record, player joined/left
- `/mc server restart`: the bot owner restarts the server from Discord, with an in-game countdown
- Scheduled daily restarts (`RESTART_SCHEDULE`) with in-game countdown – quiet unless something goes wrong
- Updates itself from GitHub releases and rolls back automatically if a new version fails to start

## How it works

The bot runs on the **same PC as the Minecraft server**. Every 15 s it sends `list uuids` and a TPS command via RCON (localhost) and does a status ping. It edits the Discord message only when something changes, plus a heartbeat every 60 s. State (message ID, records) lives in `state.json`, so restarts keep editing the same message.

## Setup (Windows)

Requirements: Node.js 20.6+ ([LTS](https://nodejs.org)), RCON enabled on the server.

1. **Discord bot:** [Developer Portal](https://discord.com/developers/applications) → *New Application* → *Bot* → *Reset Token* and copy it. No privileged intents needed. Keep the token secret.
2. **Install:** copy this folder to the server PC and run `install.bat` (installs dependencies, creates `.env`).
3. **RCON:** in `server.properties` set `enable-rcon=true`, `rcon.port` and a long `rcon.password`, then restart the server.
4. **Configure:** fill in `.env` – every setting is explained in [`.env.example`](.env.example).
5. **Start:** run `start-bot.bat`. On first start it prints an invite link – open it and add the bot to your Discord server.
6. **In Discord:** `/mc bot status-channel channel:#status` creates the live message. Optional: `/mc bot alerts channel:#alerts role:@Minecraft`. Tip: make the status channel read-only for `@everyone`.
7. **Autostart:** run `autostart-enable.bat` (starts the bot minimized at Windows login).
8. **Recommended:** run `block-rcon-firewall.bat` as administrator. It blocks the RCON port for other PCs; the bot connects locally and is not affected.
9. **For `/mc server restart`:** the bot only sends `stop` – something has to start the server again. Either copy `server-script/start-with-restart.bat` into the server folder, make sure its `java …` line matches your `run.bat` and start the server with it from now on (press `N` within 15 s after a stop to keep it off). Or, if a service, Docker or a hosting panel already restarts the server, set `RESTART_SCRIPT_NAME=none`.

Setting it up on someone else's PC with Claude Code? See [INSTALL.md](INSTALL.md). On Linux, status and alerts work too (run `npm start` under systemd or similar); the hang protection and the uptime correction need Windows.

## Configuration (`.env`)

Every key has a default – only set what you want to change. Full descriptions: [`.env.example`](.env.example).

| Key | Default | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | – | Bot token (required, secret) |
| `LANGUAGE` | `en` | `en` or `de`: Discord texts, in-game announcements, console. Command names stay English |
| `MC_HOST` / `MC_PORT` | `127.0.0.1` / `25565` | Minecraft server address |
| `RCON_PORT` / `RCON_PASSWORD` | `25575` / – | From `server.properties`. Empty password = status ping only (max. 12 names, no TPS, no restarts) |
| `SERVER_NAME`, `VERSION_TEXT` | – | Shown in the message (empty version = reported by the server) |
| `CONNECT_ADDRESS`, `VPN_NAME`, `VPN_NETWORK`, `VPN_PASSWORD` | – | "Connect" field (empty = hidden). `RADMIN_NETWORK` / `RADMIN_PASSWORD` still work |
| `INFO_TEXT` / `THUMBNAIL_URL` | – | Extra info field (`\n` = line break) / small image top right |
| `SHOW_PLAYER_LIST`, `SHOW_TPS`, `SHOW_UPTIME`, `SHOW_VERSION`, `SHOW_RECORDS`, `SHOW_NEXT_RESTART`, `SHOW_LAST_UPDATED`, `SHOW_PRESENCE` | `true` | Which parts are shown |
| `SHOW_MOTD` | `false` | Show the server's MOTD |
| `MAX_LISTED_PLAYERS` | `40` | Names listed before "… and N more" |
| `TPS_COMMAND` | `auto` | `auto`, `neoforge`, `forge`, `paper`, `vanilla` (`tick query`, 1.20.3+) |
| `POLL_INTERVAL_SECONDS` / `HEARTBEAT_SECONDS` | `15` / `60` | Query interval / forced refresh |
| `OFFLINE_AFTER_FAILS` | `3` | Failed queries in a row before "offline" |
| `ALERT_OFFLINE`, `ALERT_RECORDS`, `ALERT_RESTARTS`, `ALERT_BOT_UPDATES` | `true` | Alert types (problems are always sent) |
| `ALERT_JOIN_LEAVE` | `false` | Alert when players join / leave |
| `OFFLINE_ALERT_MINUTES` | `10` | Delay before the "offline" alert (0 = immediately) |
| `TIMEZONE` | `Europe/Berlin` | Day boundary for records, time zone of `RESTART_SCHEDULE` |
| `OWNER_IDS` | owner of the Discord app | Discord user IDs allowed to restart the server and update the bot |
| `ADMIN_ROLE_IDS` | – | Roles allowed to use `/mc bot …` in addition to *Manage Server* |
| `RESTART_ENABLED` | `true` | `false` = no restarts via the bot at all |
| `RESTART_SCRIPT_NAME` | `start-with-restart.bat` | Start script that restarts the server after `stop` (`.bat`/`.cmd`/`.sh`); `none` = no check |
| `RESTART_TIMEOUT_MINUTES` / `RESTART_COOLDOWN_MINUTES` | `10` / `5` | Alert if not back / min. gap between restarts |
| `RESTART_KILL_AFTER_MINUTES` | `5` | If the server process still runs this long after `stop` (e.g. a mod error while shutting down), the bot kills exactly that process. `0` = never. Windows only |
| `RESTART_SCHEDULE` / `RESTART_SCHEDULE_COUNTDOWN_MINUTES` | off / `5` | Daily restart times, e.g. `"04:00,16:00"` / countdown before. Skipped if the server started < 30 min ago or the start script isn't running |
| `AUTO_UPDATE` / `UPDATE_CHECK_HOURS` | `true` / `6` | Install new releases automatically |
| `UPDATE_REPO` | from `package.json` | GitHub repo for updates |

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
| `/mc bot info` | admins | Version, language, settings, RCON/TPS state, restart schedule |
| `/mc bot update` | bot owner | Check for and install a new **bot** version now |

Discord can only hide whole commands, so everyone sees all `/mc` subcommands – the bot checks permissions itself: "admins" = *Manage Server*, a role from `ADMIN_ROLE_IDS` or the bot owner; "bot owner" = the owner's Discord user ID (roles are not enough).

## Auto-update

Every 6 h (or on `/mc bot update`) the bot fetches the latest GitHub release, verifies every file against the SHA-256 checksums in `release-manifest.json`, backs up the current files to `update/backup/`, installs and restarts itself. If the new version crashes on startup, `start-bot.bat` restores the previous one and skips that version. `.env`, `state.json`, `logs/` and the server folder are never touched. Coming from an older version: [UPGRADE.md](UPGRADE.md).

> ⚠️ Whoever can publish releases in the update repo can run code on the host PC. Checksums protect against broken downloads, not against a compromised GitHub account – **enable 2FA**. Hosts who don't want this set `AUTO_UPDATE=false`. Running a fork? Point `UPDATE_REPO` (or `updateRepo` in `package.json`) at your own repo.

**Publishing a release** (repo owner, needs `git`, GitHub CLI logged in, clean `main`):

```
npm run release -- 1.3.0 "What's new (shown in Discord)"
```

This runs the tests, bumps the version, writes the manifest, tags, pushes and creates the GitHub release. Don't remove `.gitattributes` – it keeps files byte-identical so the checksums match.

## Troubleshooting

Everything is logged to the console window and `logs/bot.log`.

| Problem | Fix |
|---|---|
| `DISCORD_TOKEN is invalid` | Reset the token in the Developer Portal and update `.env` |
| `RCON … ECONNREFUSED` | Server not running, RCON disabled or wrong `RCON_PORT` |
| `RCON password is wrong` | `RCON_PASSWORD` must match `rcon.password` exactly |
| Message stays 🟡 | RCON not answering (heavy lag or wrong password) – check `/mc bot info` |
| No TPS shown | `/mc bot info` shows which TPS command is used; set `TPS_COMMAND` or `SHOW_TPS=false` |
| Slash commands missing | Reload Discord (`Ctrl+R`); re-invite the bot with the link from the console |
| `/mc server restart` warns about the script | The server was started via `run.bat` – start it once via the start script, or set `RESTART_SCRIPT_NAME=none` if a service restarts it |
| "Updated" timestamp is old | Host PC or bot is off (a hard power-off can't update the message) |

## Development

```
npm test            # unit tests (parsers, RCON/ping against mock servers, restart, updater, translations)
npm start           # run once without the restart loop
```

`src/index.js` main loop & Discord · `monitor.js` queries · `rcon.js` / `ping.js` protocols · `embed.js` message · `commands.js` slash commands · `restart.js` restart flow · `updater.js` auto-update · `i18n.js` + `locales/` texts · `tools/release.js` release script

**Adding a language:** copy `src/locales/en.js`, translate it and register it in `src/i18n.js`. `npm test` checks that no key is missing.

## License

[MIT](LICENSE)
