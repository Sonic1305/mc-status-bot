# Minecraft Status-Bot für Discord

[🇬🇧 English](README.md) · 🇩🇪 Deutsch

Ein Discord-Bot, der **eine Live-Nachricht** in einem Channel mit dem Status eures Minecraft-Servers aktuell hält. Gebaut für NeoForge 1.21, funktioniert mit jedem Server mit RCON.

- 🟢 / 🟡 / 🔴 Status, Spielerzahl und **alle Spielernamen**, TPS, Version, „Online seit“, Tages- und Allzeit-Rekord, Verbindungsdaten (z. B. Radmin VPN)
- Bot-Status zeigt die Spielerzahl in der Mitgliederliste
- Optionale Meldungen: Server offline (nach 10 Min.) / wieder online mit Rollen-Ping, neuer Spielerrekord
- `/mc server neustart`: Der Bot-Besitzer startet den Server per Discord neu, mit Countdown im Spiel
- Geplante tägliche Neustarts (`RESTART_SCHEDULE`) mit Countdown im Spiel – ohne Meldungen, außer es geht etwas schief
- Aktualisiert sich selbst über GitHub-Releases und rollt automatisch zurück, wenn eine neue Version nicht startet

## So funktioniert es

Der Bot läuft auf **demselben PC wie der Minecraft-Server**. Alle 15 s schickt er per RCON (localhost) `list uuids` und `neoforge tps` und macht einen Status-Ping. Die Discord-Nachricht wird nur bei Änderungen bearbeitet, dazu einmal pro Minute als Lebenszeichen. Der Zustand (Nachrichten-ID, Rekorde) liegt in `state.json`, nach einem Neustart wird dieselbe Nachricht weiterbearbeitet.

## Einrichtung (Windows)

Voraussetzungen: Node.js 20.6+ ([LTS](https://nodejs.org)), RCON am Server aktiviert.

1. **Discord-Bot:** [Developer Portal](https://discord.com/developers/applications) → *New Application* → *Bot* → *Reset Token* und kopieren. Keine privilegierten Intents nötig. Token geheim halten.
2. **Installieren:** Diesen Ordner auf den Server-PC kopieren und `install.bat` ausführen (installiert Abhängigkeiten, legt `.env` an).
3. **RCON:** In der `server.properties` `enable-rcon=true`, `rcon.port` und ein langes `rcon.password` setzen, Server neu starten.
4. **Konfigurieren:** `.env` ausfüllen (siehe unten).
5. **Starten:** `start-bot.bat` ausführen. Beim ersten Start erscheint ein Einladungslink – öffnen und den Bot zum Discord-Server hinzufügen.
6. **In Discord:** `/mc bot status-kanal kanal:#status` legt die Live-Nachricht an. Optional: `/mc bot meldungen kanal:#meldungen rolle:@Minecraft`. Tipp: Status-Channel für `@everyone` auf „nur lesen“ stellen.
7. **Autostart:** `autostart-einrichten.bat` ausführen (startet den Bot minimiert bei der Windows-Anmeldung).
8. **Empfohlen:** `rcon-firewall-sperren.bat` als Administrator ausführen. Sperrt den RCON-Port für andere PCs (z. B. alle im Radmin-Netz); der Bot verbindet sich lokal und ist nicht betroffen.
9. **Für `/mc server neustart`:** `server-startskript/start-mit-neustart.bat` in den Serverordner kopieren, prüfen, dass die `java …`-Zeile der aus eurer `run.bat` entspricht, und den Server ab jetzt damit starten. Es startet den Server nach jedem Beenden neu (`N` innerhalb von 15 s lässt ihn aus).

Einrichtung auf einem fremden PC mit Claude Code? Siehe [INSTALL.de.md](INSTALL.de.md).

## Konfiguration (`.env`)

| Eintrag | Standard | Bedeutung |
|---|---|---|
| `DISCORD_TOKEN` | – | Bot-Token (Pflicht, geheim) |
| `MC_HOST` / `MC_PORT` | `127.0.0.1` / `25565` | Adresse des Minecraft-Servers |
| `RCON_PORT` / `RCON_PASSWORD` | `25575` / – | Aus der `server.properties`. Leeres Passwort = nur Status-Ping (max. 12 Namen, keine TPS) |
| `SERVER_NAME`, `VERSION_TEXT` | – | Wird in der Nachricht angezeigt |
| `RADMIN_NETWORK`, `RADMIN_PASSWORD`, `CONNECT_ADDRESS` | – | Verbindungsdaten in der Nachricht (leer = ausblenden) |
| `SHOW_TPS` | `true` | TPS / ms pro Tick anzeigen |
| `POLL_INTERVAL_SECONDS` / `HEARTBEAT_SECONDS` | `15` / `60` | Abfrage-Intervall / erzwungene Aktualisierung |
| `OFFLINE_AFTER_FAILS` | `3` | Fehlgeschlagene Abfragen am Stück bis „offline“ |
| `OFFLINE_ALERT_MINUTES` | `10` | Verzögerung der Offline-Meldung (0 = sofort) |
| `OWNER_IDS` | Besitzer der Discord-App | Discord-User-IDs, die `/server` nutzen dürfen |
| `RESTART_SCRIPT_NAME` | `start-mit-neustart.bat` | Neustart-Skript im Serverordner |
| `RESTART_TIMEOUT_MINUTES` / `RESTART_COOLDOWN_MINUTES` | `10` / `5` | Warnung, wenn nicht zurück / Mindestabstand zwischen Neustarts |
| `RESTART_KILL_AFTER_MINUTES` | `5` | Läuft der Serverprozess so lange nach `stop` noch (z. B. Mod-Fehler beim Herunterfahren), beendet der Bot genau diesen Prozess, damit das Startskript neu starten kann. `0` = nie |
| `RESTART_SCHEDULE` / `RESTART_SCHEDULE_COUNTDOWN_MINUTES` | aus / `5` | Tägliche Neustart-Zeiten, z. B. `"04:00,16:00"` (in `TIMEZONE`) / Countdown davor. Wird ausgelassen, wenn der Server erst < 30 Min. läuft oder das Neustart-Skript nicht läuft. Ersetzt einen Neustart über die Windows-Aufgabenplanung – nicht beides nutzen |
| `AUTO_UPDATE` / `UPDATE_CHECK_HOURS` | `true` / `6` | Neue Releases automatisch installieren |
| `UPDATE_REPO` | aus `package.json` | GitHub-Repo für Updates |
| `TIMEZONE` | `Europe/Berlin` | Tageswechsel für den Tagesrekord |

## Befehle

Alles hängt an einem Befehl, `/mc`: `server` betrifft den Minecraft-Server, `bot` den Discord-Bot.

| Befehl | Wer | Was |
|---|---|---|
| `/mc status` | alle | Aktueller Status, nur für dich sichtbar |
| `/mc hilfe` | alle | Zeigt die Befehle, die du nutzen darfst |
| `/mc server neustart [countdown:]` | Bot-Besitzer | Minecraft-Server neu starten (sofort / 1 / 5 / 10 Min. Countdown) |
| `/mc server neustart-abbrechen` | Bot-Besitzer | Geplanten Neustart abbrechen |
| `/mc bot status-kanal kanal:` | Admins | Live-Status-Nachricht in einem Channel anlegen |
| `/mc bot meldungen kanal: [rolle:]` / `meldungen-aus` | Admins | Meldungen an / aus |
| `/mc bot rekorde-zuruecksetzen` | Admins | Tages- und Allzeit-Rekord zurücksetzen |
| `/mc bot info` | Admins | Version, Einstellungen, RCON-Zustand, Neustart-Zeitplan |
| `/mc bot update` | Bot-Besitzer | Sofort nach einer neuen **Bot**-Version suchen und installieren |

Discord kann nur ganze Befehle ausblenden, deshalb sieht jeder alle `/mc`-Unterbefehle – die Rechte prüft der Bot selbst: „Admins“ = *Server verwalten* (oder Bot-Besitzer), „Bot-Besitzer“ = Discord-User-ID des Besitzers (Rollen reichen nicht).

## Auto-Update

Alle 6 h (oder per `/mc bot update`) holt der Bot das neueste GitHub-Release, prüft jede Datei gegen die SHA-256-Prüfsummen in `release-manifest.json`, sichert die bisherigen Dateien nach `update/backup/`, installiert und startet sich neu. Stürzt die neue Version beim Start ab, stellt `start-bot.bat` die vorherige wieder her und überspringt diese Version. `.env`, `state.json`, `logs/` und der Serverordner werden nie angefasst.

> ⚠️ Wer in diesem Repo Releases veröffentlichen kann, kann Code auf dem Host-PC ausführen. Prüfsummen schützen vor kaputten Downloads, nicht vor einem übernommenen GitHub-Konto – **2FA aktivieren**. Wer das nicht will, setzt `AUTO_UPDATE=false`.

**Release veröffentlichen** (Besitzer, braucht `git`, angemeldete GitHub-CLI, sauberes `main`):

```
npm run release -- 1.3.0 "Was ist neu (erscheint in Discord)"
```

Das führt die Tests aus, setzt die Version, schreibt das Manifest, taggt, pusht und legt das GitHub-Release an. `.gitattributes` nicht entfernen – sie hält die Dateien byte-gleich, sonst stimmen die Prüfsummen nicht.

## Fehlerbehebung

Alles steht im Konsolenfenster und in `logs/bot.log`.

| Problem | Lösung |
|---|---|
| `DISCORD_TOKEN ist ungültig` | Token im Developer Portal neu erzeugen, `.env` anpassen |
| `RCON … ECONNREFUSED` | Server läuft nicht, RCON aus oder falscher `RCON_PORT` |
| `RCON-Passwort ist falsch` | `RCON_PASSWORD` muss exakt `rcon.password` entsprechen |
| Nachricht bleibt 🟡 | RCON antwortet nicht (starker Lag oder falsches Passwort) – `/mc bot info` prüfen |
| Slash-Befehle fehlen | Discord neu laden (`Strg+R`); Bot mit dem Link aus der Konsole neu einladen |
| `/mc server neustart` warnt wegen des Skripts | Server wurde über `run.bat` gestartet – einmal über `start-mit-neustart.bat` starten |
| „Aktualisiert“-Zeit ist alt | Host-PC oder Bot sind aus (nach hartem Ausschalten kann der Bot die Nachricht nicht mehr ändern) |

## Entwicklung

```
npm test            # Tests (Parser, RCON/Ping gegen Mock-Server, Neustart, Updater)
npm start           # einmal starten, ohne Neustart-Schleife
```

`src/index.js` Hauptschleife & Discord · `monitor.js` Abfragen · `rcon.js` / `ping.js` Protokolle · `embed.js` Nachricht · `commands.js` Slash-Befehle · `restart.js` Neustart · `updater.js` Auto-Update · `tools/release.js` Release-Skript

## Lizenz

[MIT](LICENSE)
