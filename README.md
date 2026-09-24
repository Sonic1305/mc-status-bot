# Minecraft Status-Bot für Discord

Zeigt in einem Discord-Channel eine **Live-Nachricht** mit dem Status eures Minecraft-Servers:

- 🟢 / 🟡 / 🔴 Online-Status, **Spielerzahl** und **alle Spielernamen**
- TPS und ms/Tick (Lag-Anzeige), Version, „Online seit“
- Tages-Peak und Allzeit-Rekord an Spielern
- Radmin-VPN-Verbindungsdaten (optional)
- Bot-Status in der Mitgliederliste, z. B. „🟢 3/16 Spieler online“

Optional schickt er Meldungen in einen zweiten Channel: Server offline (erst nach 10 Min. Ausfall) / wieder online (mit Rollen-Ping), Lag-Warnung und neuer Spielerrekord.

Außerdem kann der **Bot-Besitzer** den Server per `/server neustart` neu starten – mit Countdown im Spiel (siehe [Server-Neustart per Discord](#server-neustart-per-discord)).

Der Bot läuft auf dem **Host-PC, auf dem auch der Minecraft-Server läuft**, und fragt ihn dort lokal ab. Radmin VPN spielt für den Bot keine Rolle – er redet nur mit dem Server auf demselben PC und mit Discord.

---

## Übersicht der Einrichtung

| Schritt | Was | Dauer |
|---|---|---|
| 1 | Discord-Bot im Developer Portal anlegen | 5 Min. |
| 2 | Node.js auf dem Host-PC installieren | 3 Min. |
| 3 | Bot-Ordner auf den Host-PC kopieren und `install.bat` ausführen | 2 Min. |
| 4 | RCON im Minecraft-Server prüfen/aktivieren | 2 Min. |
| 5 | `.env` ausfüllen | 5 Min. |
| 6 | Bot starten, einladen, Channel festlegen | 5 Min. |
| 7 | Autostart einrichten | 1 Min. |
| 8 | RCON-Port absichern (empfohlen) | 1 Min. |
| 9 | Startskript für Neustarts (für `/server neustart`) | 2 Min. |

---

## 1. Discord-Bot anlegen

1. <https://discord.com/developers/applications> öffnen und mit eurem Discord-Konto anmelden.
2. **New Application** → Namen eingeben (z. B. `TNP Status`) → Bedingungen bestätigen → **Create**.
3. Links auf **Bot** klicken.
   - Optional: Profilbild und Name des Bots anpassen.
   - **Reset Token** → bestätigen → Token **kopieren** und kurz irgendwo sicher ablegen (braucht ihr in Schritt 5).
     > ⚠️ Der Token ist wie ein Passwort. Wer ihn hat, steuert den Bot. Nie in Discord posten, nie auf Screenshots zeigen. Falls er doch rausgeht: sofort **Reset Token** drücken.
   - **Privileged Gateway Intents**: alle **aus** lassen – der Bot braucht keine.
   - Empfehlung: **Public Bot** ausschalten, damit nur ihr ihn einladen könnt. (Falls Discord das nicht zulässt: links unter **Installation** den *Install Link* auf **None** stellen und dann erneut versuchen.)

Eingeladen wird der Bot in Schritt 6 – er zeigt den passenden Link beim ersten Start selbst an.

## 2. Node.js installieren (auf dem Host-PC)

1. <https://nodejs.org> öffnen und die **LTS**-Version für Windows herunterladen (`.msi`).
2. Installieren, alle Vorgaben so lassen.
3. Kontrolle: Eingabeaufforderung öffnen (`Win + R` → `cmd` → Enter) und eingeben:
   ```
   node -v
   ```
   Es muss eine Version **v20.6 oder neuer** erscheinen (z. B. `v22.15.0`).

## 3. Bot-Ordner kopieren und installieren

1. Den kompletten Ordner `mc-status-bot` auf den Host-PC kopieren, z. B. nach `C:\Gameserver\mc-status-bot`.
   (Den Unterordner `node_modules` muss man nicht mitkopieren, der wird im nächsten Schritt neu angelegt.)
2. Im Ordner **`install.bat`** doppelklicken. Das lädt die benötigte Bibliothek (discord.js) herunter und legt eine Datei **`.env`** an.

## 4. RCON im Minecraft-Server prüfen

Der Bot holt die Spielerliste über **RCON** (die Fernsteuerungs-Schnittstelle des Servers). In der `server.properties` des Servers müssen diese Zeilen so stehen:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=EinLangesZufaelligesPasswort123
```

- Ist `enable-rcon` noch `false` oder das Passwort leer: ändern und den **Minecraft-Server neu starten**.
- Das Passwort sollte lang und zufällig sein – es gibt vollen Admin-Zugriff auf den Server.
- Tipp: Falls Ops im Spiel später graue „[Rcon: …]“-Meldungen sehen, `broadcast-rcon-to-ops=false` setzen. (Die Befehle, die der Bot nutzt, sollten eigentlich keine solchen Meldungen erzeugen.)

## 5. `.env` ausfüllen

Die Datei `.env` im Bot-Ordner mit dem Editor öffnen (Rechtsklick → *Öffnen mit* → *Editor*). Die wichtigsten Einträge:

| Eintrag | Was hinein gehört |
|---|---|
| `DISCORD_TOKEN` | Der Token aus Schritt 1 |
| `RCON_PASSWORD` | Genau das `rcon.password` aus der `server.properties` |
| `RCON_PORT` / `MC_PORT` | `rcon.port` bzw. `server-port` aus der `server.properties` (meist 25575 / 25565) |
| `SERVER_NAME` | Name, der in der Nachricht steht |
| `VERSION_TEXT` | z. B. `TNP Limitless 8 v1.73.0 (NeoForge 1.21.1)` – leer = Minecraft-Version |
| `RADMIN_NETWORK` | Name eures Radmin-Netzwerks (leer = nicht anzeigen) |
| `RADMIN_PASSWORD` | Passwort des Radmin-Netzwerks – **nur** eintragen, wenn es jeder im Discord sehen darf |
| `CONNECT_ADDRESS` | Radmin-IP des Host-PCs + Port, z. B. `26.12.34.56:25565`. Die IP steht im Radmin-VPN-Fenster oben neben dem eigenen PC-Namen. |

Alles andere kann so bleiben (Erklärungen stehen direkt in der Datei). Werte am besten in `"Anführungszeichen"` setzen, vor allem wenn sie Leer- oder Sonderzeichen enthalten. Speichern nicht vergessen.

<details>
<summary>Alle Einstellungen im Detail</summary>

| Eintrag | Standard | Bedeutung |
|---|---|---|
| `MC_HOST` | `127.0.0.1` | Adresse des Servers. So lassen, wenn der Bot auf demselben PC läuft. |
| `SHOW_TPS` | `true` | TPS/ms pro Tick anzeigen (nutzt `neoforge tps`) |
| `POLL_INTERVAL_SECONDS` | `15` | Wie oft der Server abgefragt wird. Joins/Leaves erscheinen spätestens nach dieser Zeit. |
| `HEARTBEAT_SECONDS` | `60` | Auch ohne Änderung wird die Nachricht so oft aktualisiert (Lebenszeichen). |
| `OFFLINE_AFTER_FAILS` | `3` | Erst nach so vielen Fehlschlägen am Stück gilt der Server als offline (verhindert Fehlalarm bei Lag). |
| `TPS_ALERT_THRESHOLD` | `15` | Lag-Warnung, wenn die TPS darunter liegen … |
| `TPS_ALERT_SECONDS` | `120` | … und zwar so lange am Stück. |
| `OFFLINE_ALERT_MINUTES` | `10` | „Server offline“-Meldung erst nach so vielen Minuten Ausfall (0 = sofort). Kurze Ausfälle bleiben ohne Ping. |
| `TIMEZONE` | `Europe/Berlin` | Für den Tageswechsel beim Tagesrekord |
| `OWNER_IDS` | leer | Wer `/server neustart` nutzen darf (Discord-User-IDs, mit Komma). Leer = Besitzer der Discord-Application. |
| `RESTART_SCRIPT_NAME` | `start-mit-neustart.bat` | Name des Startskripts im Serverordner |
| `RESTART_TIMEOUT_MINUTES` | `10` | Warnung, wenn der Server so lange nach dem Neustart nicht zurück ist |
| `RESTART_COOLDOWN_MINUTES` | `5` | Mindestabstand zwischen zwei Neustarts |
| `AUTO_UPDATE` | `true` | Neue Versionen von GitHub automatisch installieren (`false` = nie, auch nicht per `/server update`) |
| `UPDATE_CHECK_HOURS` | `6` | Wie oft auf Updates geprüft wird |
| `UPDATE_REPO` | aus `package.json` | GitHub-Repository für Updates (`besitzer/repo`) |

</details>

## 6. Starten, einladen, Channel festlegen

1. **`start-bot.bat`** doppelklicken. Ein Konsolenfenster öffnet sich. Beim ersten Start steht dort etwa:
   ```
   INFO   Bei Discord angemeldet als TNP Status#1234.
   WARNUNG Der Bot ist noch auf keinem Discord-Server. Mit diesem Link einladen:
     https://discord.com/oauth2/authorize?client_id=...
   ```
2. Den Link im Browser öffnen, euren Discord-Server auswählen, **Autorisieren**. (Dafür braucht ihr auf dem Discord-Server das Recht „Server verwalten“.)
3. In Discord einen Channel für die Anzeige anlegen, z. B. `#server-status`.
   Empfehlung: In den Channel-Einstellungen unter *Berechtigungen* bei `@everyone` **Nachrichten senden** verbieten – dann bleibt die Status-Nachricht immer sichtbar und rutscht nicht nach oben weg. Falls der Channel privat ist, den Bot dort explizit hinzufügen.
4. In einem beliebigen Channel eingeben:
   ```
   /statusbot setup kanal:#server-status
   ```
   Der Bot postet die Live-Nachricht und aktualisiert sie ab jetzt selbst.
5. Optional – Meldungen bei Offline/Online, Lag und Rekord:
   ```
   /statusbot alarm kanal:#server-meldungen rolle:@Minecraft
   ```
   Die Rolle ist optional und wird nur bei Offline/Online erwähnt. Am besten einen **eigenen** Channel nehmen, nicht den Status-Channel.

> Die `/statusbot`-Befehle sehen nur Mitglieder mit dem Recht „Server verwalten“. `/status` kann jeder nutzen.

## 7. Autostart einrichten

**`autostart-einrichten.bat`** doppelklicken. Der Bot startet dann bei jeder Windows-Anmeldung automatisch in einem **minimierten** Fenster.

- Das Fenster **nicht schließen** – Schließen beendet den Bot. Die Nachricht zeigt dann „⚫ Status unbekannt – Bot beendet“.
- Stürzt der Bot ab, startet ihn das Fenster nach 15 Sekunden selbst neu.
- Entfernen mit `autostart-entfernen.bat`.

## 8. RCON-Port absichern (empfohlen)

Im Radmin-Netz können alle Mitglieder jeden Port des Host-PCs erreichen, also auch RCON (25575). Wer das RCON-Passwort kennt, hätte damit volle Admin-Rechte. Der Bot braucht den Zugriff von außen nicht – er verbindet sich lokal.

**`rcon-firewall-sperren.bat`** per **Rechtsklick → Als Administrator ausführen**. Das legt eine Windows-Firewall-Regel an, die den RCON-Port von außen sperrt. Der lokale Zugriff des Bots ist davon nicht betroffen.

Kontrolle: Die Status-Nachricht bleibt danach 🟢 (nicht 🟡).
Rückgängig machen (Eingabeaufforderung als Administrator):
```
netsh advfirewall firewall delete rule name="Minecraft RCON von aussen sperren"
```

## 9. Startskript für Neustarts

Damit `/server neustart` funktioniert, muss den Server nach dem Herunterfahren etwas wieder starten. Das übernimmt `server-startskript\start-mit-neustart.bat`:

1. Die Datei in den **Serverordner** kopieren (neben `run.bat`).
2. Prüfen, dass die `java …`-Zeile darin genau der aus eurer `run.bat` entspricht (andere NeoForge-Version = anderer Pfad).
3. Den Server ab jetzt **mit dieser Datei starten** statt mit `run.bat` – auch in Verknüpfungen oder im Autostart.

Das Skript startet den Server nach jedem Beenden nach 15 Sekunden neu – egal ob durch `/server neustart`, `/stop` im Spiel oder einen Absturz. **Dauerhaft ausschalten:** nach dem Herunterfahren innerhalb der 15 Sekunden `N` drücken oder das Fenster schließen. Stürzt der Server 3× hintereinander in den ersten 5 Minuten ab, hört das Skript auf, neu zu starten.

---

## Server-Neustart per Discord

```
/server neustart countdown:5 Minuten
```

1. Der Bot fragt (nur für dich sichtbar) nach: wie viele Spieler online sind und ob das Startskript läuft → **[Neu starten]** / **[Abbrechen]**.
2. Im Spiel erscheint ein Countdown („Server-Neustart in 5 Minuten!“ … 30 s, 10 s, 5 … 1).
3. Der Bot schickt per RCON `stop`, der Server speichert und fährt herunter, das Startskript startet ihn neu.
4. Die Status-Nachricht zeigt „🔄 startet neu“, im Meldungs-Channel steht, wer den Neustart ausgelöst hat und wie lange er gedauert hat.

Abbrechen während des Countdowns: `/server neustart-abbrechen`.

**Wer darf das?** Nur der Besitzer der Discord-Application (oder die IDs in `OWNER_IDS`). Der Bot prüft das selbst anhand der Discord-User-ID – Rollen oder Admin-Rechte auf dem Discord-Server reichen nicht. Discord blendet den Befehl zusätzlich für alle ohne Administrator-Recht aus.

**Sicherheitsmerkmale:**
- Kein Freitext: Aus Discord gelangt kein Text in die Serverkonsole, der Bot schickt nur feste Befehle.
- Mit dem Bot-Token allein kann niemand einen Neustart auslösen – RCON ist nur lokal auf dem Host-PC erreichbar.
- Bestätigungs-Knopf, Countdown im Spiel, kein zweiter Neustart während eines laufenden, mindestens 5 Minuten Abstand.
- Kommt der Server nach 10 Minuten nicht zurück, gibt es eine Warnung mit Rollen-Ping.
- **Empfehlung:** Zwei-Faktor-Anmeldung für dein Discord-Konto aktivieren – wer dein Konto übernimmt, könnte sonst den Server neu starten.

---

## Befehle in Discord

| Befehl | Wer | Was |
|---|---|---|
| `/status` | alle | Zeigt den aktuellen Status nur für dich |
| `/statusbot setup kanal:` | Admins | Live-Nachricht in diesem Channel anlegen (eine alte wird gelöscht) |
| `/statusbot alarm kanal: [rolle:]` | Admins | Meldungen in diesen Channel schicken, optional mit Rollen-Ping |
| `/statusbot alarm-aus` | Admins | Meldungen abschalten |
| `/statusbot rekorde-zuruecksetzen` | Admins | Tages- und Allzeit-Rekord zurücksetzen |
| `/statusbot info` | Admins | Einstellungen, RCON-Zustand, letzte Abfrage |
| `/server neustart [countdown:]` | nur Bot-Besitzer | Server neu starten (sofort / 1 / 5 / 10 Min. Countdown) |
| `/server neustart-abbrechen` | nur Bot-Besitzer | Geplanten Neustart abbrechen |
| `/server update` | nur Bot-Besitzer | Sofort auf eine neue Bot-Version prüfen und installieren |

## Was die Anzeige bedeutet

| Anzeige | Bedeutung |
|---|---|
| 🟢 online | Alles in Ordnung |
| 🟡 online (eingeschränkt) | Server erreichbar, aber RCON antwortet nicht – meist starker Lag oder falsches RCON-Passwort. Es werden max. ~12 Namen angezeigt. |
| 🔴 offline | Server nicht erreichbar (aus, startet gerade oder abgestürzt) |
| 🔄 startet neu | Neustart per `/server neustart` läuft |
| ⚫ Status unbekannt | Der Bot wurde beendet |
| „Aktualisiert vor …“ ist alt | Host-PC oder Bot sind hart ausgegangen (z. B. Stromausfall) – der Bot konnte die Nachricht nicht mehr ändern |

---

## So funktioniert der Bot technisch

```
 Host-PC (Windows)
┌─────────────────────────────────────────────────────────┐
│  Minecraft-Server ◄── RCON 127.0.0.1:25575 ──┐           │
│  (NeoForge)       ◄── Status-Ping :25565 ────┤           │         Discord
│                                              │           │     ┌────────────────┐
│                            Status-Bot (Node.js) ─────────┼────►│ #server-status │
│                            state.json, logs/bot.log      │     └────────────────┘
└─────────────────────────────────────────────────────────┘
```

- Alle 15 Sekunden schickt der Bot per RCON `list uuids` (vollständige Spielerliste) und `neoforge tps` (Lag-Werte) an den Server und macht zusätzlich einen normalen Status-Ping (wie die Serverliste im Spiel).
- Die Discord-Nachricht wird **nur bearbeitet, wenn sich etwas ändert** (Join, Leave, Statuswechsel, Lag-Stufe) – plus einmal pro Minute als Lebenszeichen. Das bleibt weit unter den Discord-Limits.
- „Aktualisiert vor …“ und „Online seit …“ sind Discord-Zeitstempel: Die zählt Discord selbst hoch, in der Zeitzone des jeweiligen Betrachters.
- In `state.json` merkt sich der Bot, wo die Nachricht steht, sowie die Rekorde. Nach einem Neustart bearbeitet er dieselbe Nachricht weiter. Wird sie gelöscht, postet er sie neu.
- Einzelne fehlgeschlagene Abfragen (z. B. bei einer Lag-Spitze) werden toleriert, erst nach 3 Fehlschlägen am Stück gilt der Server als offline.

## Fehlerbehebung

Alles, was der Bot tut, steht im Konsolenfenster und in **`logs/bot.log`**.

| Meldung / Problem | Lösung |
|---|---|
| `DISCORD_TOKEN ist ungültig` | Im Developer Portal unter *Bot* → *Reset Token* einen neuen Token erzeugen und in die `.env` eintragen |
| `Keine Verbindung zu RCON … (ECONNREFUSED)` | Server ist aus/startet noch – oder RCON ist nicht aktiviert bzw. `RCON_PORT` stimmt nicht (Schritt 4) |
| `RCON-Passwort ist falsch` | `RCON_PASSWORD` in der `.env` muss exakt dem `rcon.password` der `server.properties` entsprechen |
| Nachricht dauerhaft 🟡 | RCON-Problem, siehe `/statusbot info` und das Log |
| `/statusbot` erscheint nicht in Discord | Discord mit `Strg + R` neu laden. Hilft das nicht: Bot mit dem Link aus dem Konsolenfenster erneut einladen (der Link enthält die nötige Berechtigung für Befehle). |
| „Mir fehlen in #… diese Rechte“ | Dem Bot in dem Channel die genannten Rechte geben (Channel-Einstellungen → Berechtigungen) |
| Rolle wird bei Meldungen nicht gepingt | Rolle in den Server-Einstellungen auf „Erlauben, dass jeder diese Rolle @erwähnen kann“ stellen |
| Keine TPS-Anzeige | Der Server ist kein NeoForge-Server oder `SHOW_TPS=false` |
| `Node.js wurde nicht gefunden` | Schritt 2; danach den PC einmal neu anmelden |
| Konsolenfenster schließt sich sofort | `start-bot.bat` aus einer Eingabeaufforderung starten, dann bleibt die Fehlermeldung sichtbar |
| `/server neustart` warnt „kein laufendes start-mit-neustart.bat“ | Der Server wurde über `run.bat` gestartet – nach `stop` bliebe er aus. Server einmal über `start-mit-neustart.bat` starten (Schritt 9). |
| `/server` fehlt in Discord | Nur für Mitglieder mit Administrator-Recht sichtbar. `/server` antwortet „Nur der Bot-Besitzer …“ → `OWNER_IDS` prüfen bzw. Besitzer im Log („/server neustart erlaubt für …“). |
| „Update-Prüfung fehlgeschlagen“ im Log | Meist kurz keine Internetverbindung oder GitHub-Limit – der Bot versucht es beim nächsten Intervall erneut |
| „Status-Bot-Update … fehlgeschlagen“ in Discord | Die neue Version ist abgestürzt und wurde zurückgerollt. `logs\bot.log` prüfen; `/server update` versucht es gezielt erneut |
| Server nach Neustart nicht zurück | Am Host-PC ins Fenster „Minecraft-Server (mit Auto-Neustart)“ schauen – wurde `N` gedrückt oder hat der Absturzschutz gegriffen? |

## Automatische Updates

Ab Version 1.2 aktualisiert sich der Bot selbst aus diesem GitHub-Repository:

1. Alle 6 Stunden (und per `/server update`) fragt er das neueste GitHub-Release ab.
2. Ist es neuer, lädt er die Dateien der Version und prüft jede gegen die SHA-256-Prüfsumme aus `release-manifest.json`.
3. Er sichert die bisherigen Dateien nach `update\backup\`, spielt die neuen ein (bei geänderten Abhängigkeiten inkl. `npm ci`) und startet sich neu. Der Minecraft-Server ist davon nicht betroffen.
4. Stürzt die neue Version beim Start ab, stellt `start-bot.bat` automatisch die vorherige Version wieder her; die fehlerhafte Version wird dann nicht erneut automatisch installiert.
5. Im Meldungs-Channel steht jeweils, was passiert ist (inkl. Release-Notizen).

Nie angefasst werden: `.env`, `state.json`, `logs\`, der Minecraft-Serverordner. Während eines Server-Neustarts wird kein Update installiert.

> ⚠️ **Vertrauensfrage:** Wer Releases in diesem Repository veröffentlichen kann, kann Code auf dem Host-PC ausführen. Die Prüfsummen schützen vor beschädigten Downloads, nicht vor einem übernommenen GitHub-Konto. Deshalb: **Zwei-Faktor-Anmeldung für das GitHub-Konto** des Besitzers. Wer das nicht möchte, setzt auf dem Host `AUTO_UPDATE=false` und aktualisiert von Hand.

### Neue Version veröffentlichen (Besitzer)

Voraussetzungen: `git`, GitHub-CLI (`gh auth login` einmalig), alle Änderungen committet, Branch `main`.

```
npm run release -- 1.3.0 "Kurze Beschreibung, erscheint in Discord"
```

Das Skript (`tools\release.js`) führt die Tests aus, setzt die Version, erzeugt `release-manifest.json` mit den Prüfsummen, committet, taggt, pusht und legt das GitHub-Release an. Die Bots installieren es bei ihrer nächsten Prüfung.

> `.gitattributes` sorgt dafür, dass Git Dateien byte-genau speichert – sonst stimmen die Prüfsummen nicht. Nicht entfernen.

## Update und Deinstallation

- **Update:** passiert automatisch (siehe oben). Von Hand: neue Dateien in den Ordner kopieren, `.env` und `state.json` dabei **behalten**, danach `install.bat` ausführen und den Bot neu starten.
- **Deinstallation:** `autostart-entfernen.bat` ausführen, Bot-Fenster schließen, Ordner löschen. In Discord den Bot vom Server kicken und ggf. die Application im Developer Portal löschen.

> 🔒 Die `.env` enthält Bot-Token und RCON-Passwort. Den Ordner deshalb nicht mitsamt `.env` weitergeben oder in Uploads/Zips packen.

## Für Entwickler

```
npm test                 # Tests (Parser, RCON-/Ping-Protokoll gegen Mock-Server, Embed)
npm start                # wie start-bot.bat, aber ohne Neustart-Schleife
```

`src/index.js` Ablauf & Discord · `src/restart.js` Neustart-Ablauf · `src/updater.js` Auto-Update · `tools/release.js` Release-Skript · `src/monitor.js` Abfrage & Parser · `src/rcon.js` RCON-Client · `src/ping.js` Status-Ping · `src/embed.js` Nachricht · `src/commands.js` Slash-Befehle · `src/state.js` Speicherstand
