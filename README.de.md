# Minecraft Status-Bot für Discord

[🇬🇧 English](README.md) · 🇩🇪 Deutsch

Ein Discord-Bot, der **eine Live-Nachricht** in einem Channel mit dem Status eures Minecraft-Servers aktuell hält. Funktioniert mit jedem Java-Server mit RCON – NeoForge, Forge, Paper/Spigot, Fabric, Vanilla. Texte auf **Englisch oder Deutsch** (`LANGUAGE=de`).

- 🟢 / 🟡 / 🔴 Status, Spielerzahl und **alle Spielernamen**, TPS, Version, „Online seit“, Tages- und Allzeit-Rekord, Verbindungsdaten (Adresse, optional VPN), eigener Infotext – jeder Teil lässt sich ein- und ausschalten
- Bot-Status zeigt die Spielerzahl in der Mitgliederliste
- Optionale Meldungen: Server offline (nach 10 Min.) / wieder online mit Rollen-Ping, neuer Spielerrekord, Spieler beigetreten/gegangen
- `/mc server restart`: Der Bot-Besitzer startet den Server per Discord neu, mit Countdown im Spiel
- Geplante tägliche Neustarts (`RESTART_SCHEDULE`) mit Countdown im Spiel – ohne Meldungen, außer es geht etwas schief
- Aktualisiert sich selbst über GitHub-Releases und rollt automatisch zurück, wenn eine neue Version nicht startet

## So funktioniert es

Der Bot läuft auf **demselben PC wie der Minecraft-Server**. Alle 15 s schickt er per RCON (localhost) `list uuids` und einen TPS-Befehl und macht einen Status-Ping. Die Discord-Nachricht wird nur bei Änderungen bearbeitet, dazu einmal pro Minute als Lebenszeichen. Der Zustand (Nachrichten-ID, Rekorde) liegt in `state.json`, nach einem Neustart wird dieselbe Nachricht weiterbearbeitet.

## Einrichtung (Windows)

Voraussetzungen: Node.js 20.6+ ([LTS](https://nodejs.org)), RCON am Server aktiviert.

1. **Discord-Bot:** [Developer Portal](https://discord.com/developers/applications) → *New Application* → *Bot* → *Reset Token* und kopieren. Keine privilegierten Intents nötig. Token geheim halten.
2. **Installieren:** Diesen Ordner auf den Server-PC kopieren und `install.bat` ausführen (installiert Abhängigkeiten, legt `.env` an).
3. **RCON:** In der `server.properties` `enable-rcon=true`, `rcon.port` und ein langes `rcon.password` setzen, dann den Server neu starten.
4. **Einstellen:** `.env` ausfüllen – jede Einstellung ist in der [`.env.example`](.env.example) erklärt. Für deutsche Texte `LANGUAGE="de"` setzen.
5. **Starten:** `start-bot.bat` ausführen. Beim ersten Start steht ein Einladungslink in der Konsole – öffnen und den Bot auf euren Discord-Server holen.
6. **In Discord:** `/mc bot status-channel channel:#status` legt die Live-Nachricht an. Optional: `/mc bot alerts channel:#meldungen role:@Minecraft`. Tipp: Den Status-Channel für `@everyone` auf „nur lesen“ stellen.
7. **Autostart:** `autostart-enable.bat` ausführen (startet den Bot minimiert bei der Windows-Anmeldung).
8. **Empfohlen:** `block-rcon-firewall.bat` als Administrator ausführen. Sperrt den RCON-Port für andere PCs; der Bot verbindet sich lokal und ist nicht betroffen.
9. **Für `/mc server restart`:** Der Bot schickt nur `stop` – den Server muss danach etwas wieder starten. Entweder `server-script/start-with-restart.bat` in den Serverordner kopieren, prüfen, dass die `java …`-Zeile der aus der `run.bat` entspricht, und den Server ab jetzt damit starten (nach einem Stopp innerhalb von 15 s `N` drücken, damit er aus bleibt). Oder, wenn schon ein Dienst, Docker oder ein Hosting-Panel den Server neu startet, `RESTART_SCRIPT_NAME=none` setzen.

Einrichtung auf einem fremden PC mit Claude Code? Siehe [INSTALL.de.md](INSTALL.de.md). Unter Linux funktionieren Status und Meldungen ebenfalls (`npm start` z. B. per systemd); Hänger-Absicherung und die Korrektur von „Online seit“ brauchen Windows.

## Einstellungen (`.env`)

Jede Einstellung hat einen Standard – nur eintragen, was abweichen soll. Ausführliche Beschreibungen: [`.env.example`](.env.example).

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `DISCORD_TOKEN` | – | Bot-Token (Pflicht, geheim) |
| `LANGUAGE` | `en` | `en` oder `de`: Discord-Texte, Ansagen im Spiel, Konsole. Befehlsnamen bleiben englisch |
| `MC_HOST` / `MC_PORT` | `127.0.0.1` / `25565` | Adresse des Minecraft-Servers |
| `RCON_PORT` / `RCON_PASSWORD` | `25575` / – | Aus der `server.properties`. Leeres Passwort = nur Status-Ping (max. 12 Namen, keine TPS, keine Neustarts) |
| `SERVER_NAME`, `VERSION_TEXT` | – | Erscheinen in der Nachricht (leere Version = vom Server gemeldet) |
| `CONNECT_ADDRESS`, `VPN_NAME`, `VPN_NETWORK`, `VPN_PASSWORD` | – | Feld „Verbinden“ (leer = ausgeblendet). `RADMIN_NETWORK` / `RADMIN_PASSWORD` funktionieren weiter |
| `INFO_TEXT` / `THUMBNAIL_URL` | – | Zusätzliches Infofeld (`\n` = Zeilenumbruch) / kleines Bild oben rechts |
| `SHOW_PLAYER_LIST`, `SHOW_TPS`, `SHOW_UPTIME`, `SHOW_VERSION`, `SHOW_RECORDS`, `SHOW_NEXT_RESTART`, `SHOW_LAST_UPDATED`, `SHOW_PRESENCE` | `true` | Welche Teile angezeigt werden |
| `SHOW_MOTD` | `false` | MOTD des Servers anzeigen |
| `MAX_LISTED_PLAYERS` | `40` | So viele Namen, danach „… und N weitere“ |
| `TPS_COMMAND` | `auto` | `auto`, `neoforge`, `forge`, `paper`, `vanilla` (`tick query`, ab 1.20.3) |
| `POLL_INTERVAL_SECONDS` / `HEARTBEAT_SECONDS` | `15` / `60` | Abfrage-Intervall / erzwungene Aktualisierung |
| `OFFLINE_AFTER_FAILS` | `3` | Fehlgeschlagene Abfragen in Folge bis „offline“ |
| `ALERT_OFFLINE`, `ALERT_RECORDS`, `ALERT_RESTARTS`, `ALERT_BOT_UPDATES` | `true` | Meldungsarten (Probleme werden immer gemeldet) |
| `ALERT_JOIN_LEAVE` | `false` | Meldung, wenn Spieler beitreten / gehen |
| `OFFLINE_ALERT_MINUTES` | `10` | Verzögerung der Offline-Meldung (0 = sofort) |
| `TIMEZONE` | `Europe/Berlin` | Tageswechsel für Rekorde, Zeitzone von `RESTART_SCHEDULE` |
| `OWNER_IDS` | Besitzer der Discord-App | Discord-User-IDs, die den Server neu starten und den Bot aktualisieren dürfen |
| `ADMIN_ROLE_IDS` | – | Rollen, die `/mc bot …` nutzen dürfen, zusätzlich zu *Server verwalten* |
| `RESTART_ENABLED` | `true` | `false` = gar keine Neustarts per Bot |
| `RESTART_SCRIPT_NAME` | `start-with-restart.bat` | Startskript, das den Server nach `stop` neu startet (`.bat`/`.cmd`/`.sh`); `none` = keine Prüfung |
| `RESTART_TIMEOUT_MINUTES` / `RESTART_COOLDOWN_MINUTES` | `10` / `5` | Warnung, wenn nicht zurück / Mindestabstand zwischen Neustarts |
| `RESTART_KILL_AFTER_MINUTES` | `5` | Läuft der Serverprozess so lange nach `stop` noch (z. B. Mod-Fehler beim Herunterfahren), beendet der Bot genau diesen Prozess. `0` = nie. Nur Windows |
| `RESTART_SCHEDULE` / `RESTART_SCHEDULE_COUNTDOWN_MINUTES` | aus / `5` | Tägliche Neustartzeiten, z. B. `"04:00,16:00"` / Countdown vorher. Entfällt, wenn der Server < 30 Min. läuft oder das Startskript nicht läuft |
| `AUTO_UPDATE` / `UPDATE_CHECK_HOURS` | `true` / `6` | Neue Releases automatisch installieren |
| `UPDATE_REPO` | aus `package.json` | GitHub-Repo für Updates |

## Befehle

Alles hängt an einem Befehl, `/mc`: `server` betrifft den Minecraft-Server, `bot` den Discord-Bot. Die Befehlsnamen sind immer englisch, Beschreibungen und Antworten folgen `LANGUAGE`.

| Befehl | Wer | Was |
|---|---|---|
| `/mc status` | alle | Aktueller Status, nur für dich sichtbar |
| `/mc help` | alle | Zeigt die Befehle, die du nutzen darfst |
| `/mc server restart [countdown:]` | Bot-Besitzer | Minecraft-Server neu starten (sofort / 1 / 5 / 10 Min. Countdown) |
| `/mc server cancel-restart` | Bot-Besitzer | Geplanten Neustart abbrechen |
| `/mc bot status-channel channel:` | Admins | Live-Status-Nachricht in einem Channel anlegen |
| `/mc bot alerts channel: [role:]` / `alerts-off` | Admins | Meldungen an / aus |
| `/mc bot reset-records` | Admins | Tages- und Allzeit-Rekord zurücksetzen |
| `/mc bot info` | Admins | Version, Sprache, Einstellungen, RCON-/TPS-Zustand, Neustart-Zeitplan |
| `/mc bot update` | Bot-Besitzer | Sofort nach einer neuen **Bot**-Version suchen und installieren |

Discord kann nur ganze Befehle ausblenden, deshalb sieht jeder alle `/mc`-Unterbefehle – die Rechte prüft der Bot selbst: „Admins“ = *Server verwalten*, eine Rolle aus `ADMIN_ROLE_IDS` oder Bot-Besitzer; „Bot-Besitzer“ = Discord-User-ID des Besitzers (Rollen reichen nicht).

## Auto-Update

Alle 6 h (oder per `/mc bot update`) holt der Bot das neueste GitHub-Release, prüft jede Datei gegen die SHA-256-Prüfsummen in `release-manifest.json`, sichert die bisherigen Dateien nach `update/backup/`, installiert und startet sich neu. Stürzt die neue Version beim Start ab, stellt `start-bot.bat` die vorherige wieder her und überspringt diese Version. `.env`, `state.json`, `logs/` und der Serverordner werden nie angefasst. Installationen von vor v1.3 bleiben nach dem Update deutsch; `LANGUAGE` in der `.env` ändert das.

> ⚠️ Wer im Update-Repo Releases veröffentlichen kann, kann Code auf dem Host-PC ausführen. Prüfsummen schützen vor kaputten Downloads, nicht vor einem übernommenen GitHub-Konto – **2FA aktivieren**. Wer das nicht will, setzt `AUTO_UPDATE=false`. Eigener Fork? `UPDATE_REPO` (oder `updateRepo` in der `package.json`) auf das eigene Repo setzen.

**Release veröffentlichen** (Repo-Besitzer, braucht `git`, angemeldete GitHub-CLI, sauberes `main`):

```
npm run release -- 1.3.0 "Was ist neu (erscheint in Discord)"
```

Das führt die Tests aus, setzt die Version, schreibt das Manifest, taggt, pusht und legt das GitHub-Release an. `.gitattributes` nicht entfernen – sie hält die Dateien byte-gleich, sonst stimmen die Prüfsummen nicht.

## Fehlerbehebung

Alles steht im Konsolenfenster und in `logs/bot.log` (in der Sprache aus `LANGUAGE`).

| Problem | Lösung |
|---|---|
| `DISCORD_TOKEN ist ungültig` / `is invalid` | Token im Developer Portal neu erzeugen, `.env` anpassen |
| `RCON … ECONNREFUSED` | Server läuft nicht, RCON aus oder falscher `RCON_PORT` |
| `RCON-Passwort ist falsch` / `password is wrong` | `RCON_PASSWORD` muss exakt `rcon.password` entsprechen |
| Nachricht bleibt 🟡 | RCON antwortet nicht (starker Lag oder falsches Passwort) – `/mc bot info` prüfen |
| Keine TPS | `/mc bot info` zeigt, welcher TPS-Befehl genutzt wird; `TPS_COMMAND` oder `SHOW_TPS=false` setzen |
| Slash-Befehle fehlen | Discord neu laden (`Strg+R`); Bot mit dem Link aus der Konsole neu einladen |
| `/mc server restart` warnt wegen des Skripts | Server wurde über `run.bat` gestartet – einmal über das Startskript starten, oder `RESTART_SCRIPT_NAME=none`, wenn ein Dienst ihn neu startet |
| „Aktualisiert“-Zeit ist alt | Host-PC oder Bot sind aus (nach hartem Ausschalten kann der Bot die Nachricht nicht mehr ändern) |

## Entwicklung

```
npm test            # Tests (Parser, RCON/Ping gegen Mock-Server, Neustart, Updater, Übersetzungen)
npm start           # einmal starten, ohne Neustart-Schleife
```

`src/index.js` Hauptschleife & Discord · `monitor.js` Abfragen · `rcon.js` / `ping.js` Protokolle · `embed.js` Nachricht · `commands.js` Slash-Befehle · `restart.js` Neustart · `updater.js` Auto-Update · `i18n.js` + `locales/` Texte · `tools/release.js` Release-Skript

**Neue Sprache:** `src/locales/en.js` kopieren, übersetzen und in `src/i18n.js` eintragen. `npm test` prüft, dass kein Schlüssel fehlt.

## Lizenz

[MIT](LICENSE)
