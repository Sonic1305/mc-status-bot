# Installation beim Hoster (mit Claude Code)

[🇬🇧 English](INSTALL.md) · 🇩🇪 Deutsch

## Für den Hoster

1. Auf dem PC entpacken, auf dem der Minecraft-Server läuft, z. B. nach `C:\Gameserver\mc-status-bot`.
2. Die separat erhaltene **`.env`** in diesen Ordner legen (Name exakt `.env`, nicht `.env.txt`).
3. Claude Code im Ordner öffnen und sagen: **„Lies INSTALL.de.md und richte den Bot ein.“**

Die `.env` enthält Bot-Token und RCON-Passwort – niemals weitergeben. Der Bot **aktualisiert sich selbst** von GitHub, wenn der Besitzer eine neue Version veröffentlicht; sag Bescheid, wenn du das nicht willst.

---

## Für Claude

Richte den fertigen Discord-Status-Bot auf diesem Windows-PC ein. Er läuft neben dem Minecraft-Server und fragt ihn lokal ab (RCON + Status-Ping). Hintergrund: `README.de.md`.

**Regeln**
- Nie Geheimnisse ausgeben (`DISCORD_TOKEN`, `RCON_PASSWORD`, `RADMIN_PASSWORD`). Beim Vergleichen nur „stimmt / stimmt nicht“ melden.
- `DISCORD_TOKEN` und Code in `src/` nicht ändern.
- Den Minecraft-Server nicht stoppen/neu starten und `server.properties` nicht ändern ohne ausdrückliches OK – es können Spieler online sein.
- Keine Firewall-Ports öffnen (der Bot verbindet sich nur ausgehend).
- Pro Token nur eine Instanz: fragen, ob der Bot woanders läuft, und ihn dort zuerst beenden lassen.

### 1. Voraussetzungen
- `node -v` muss ≥ 20.6 sein. Fehlt Node, vor `winget install OpenJS.NodeJS.LTS` fragen (danach neue Shell).
- `.env` muss existieren (nur Existenz prüfen). Fehlt sie, beim Nutzer anfragen – nicht aus `.env.example` anlegen.
- Nach dem Serverordner fragen (enthält `server.properties`, `mods/`, `run.bat`).
- IPv4 des Adapters **„Radmin VPN“** aus `ipconfig` notieren (beginnt mit `26.`).

### 2. Installieren und testen
```powershell
npm install --omit=dev --no-audit --no-fund
npm test          # muss mit "# fail 0" enden
```

### 3. `.env` mit dem Server abgleichen
```powershell
$server = 'C:\PFAD\ZUM\SERVER'; $bot = 'C:\PFAD\ZUM\mc-status-bot'
function Read-KV($f) { $h=@{}; Get-Content $f | ? { $_ -match '^\s*[^#\s][^=]*=' } | % { $k,$v = $_ -split '=',2; $h[$k.Trim()] = $v.Trim().Trim('"') }; $h }
$p = Read-KV "$server\server.properties"; $e = Read-KV "$bot\.env"
[pscustomobject]@{ 'enable-rcon'=$p['enable-rcon']; 'server-ip'=$p['server-ip']; MC_HOST=$e['MC_HOST']
  'MC_PORT ok'=$e['MC_PORT'] -eq $p['server-port']; 'RCON_PORT ok'=$e['RCON_PORT'] -eq $p['rcon.port']
  'RCON_PASSWORD ok'=$e['RCON_PASSWORD'] -eq $p['rcon.password']; CONNECT_ADDRESS=$e['CONNECT_ADDRESS'] } | Format-List
```
- `enable-rcon` muss `true` sein – sonst anhalten und fragen (braucht Änderung der `server.properties` + Server-Neustart).
- `MC_HOST` sollte `127.0.0.1` sein (bzw. der Wert von `server-ip`, falls gesetzt). Der Besitzer hat die `.env` auf einem anderen PC ausgefüllt, die Änderung ist also gewollt.
- Ports und Passwort: Die `server.properties` ist maßgeblich.
- `CONNECT_ADDRESS` = `<Radmin-IP>:<server-port>`.

Werte ändern, ohne sie auszugeben (speichert UTF-8 ohne BOM):
```powershell
$h = if ([string]::IsNullOrWhiteSpace($p['server-ip'])) { '127.0.0.1' } else { $p['server-ip'] }
$lines = Get-Content "$bot\.env" -Encoding UTF8 | % {
  if ($_ -like 'MC_HOST=*') { "MC_HOST=`"$h`"" } elseif ($_ -like 'RCON_PASSWORD=*') { 'RCON_PASSWORD="' + $p['rcon.password'] + '"' }
  elseif ($_ -like 'RCON_PORT=*') { 'RCON_PORT=' + $p['rcon.port'] } elseif ($_ -like 'MC_PORT=*') { 'MC_PORT=' + $p['server-port'] } else { $_ } }
[IO.File]::WriteAllLines("$bot\.env", [string[]]$lines, (New-Object Text.UTF8Encoding $false))
```

### 4. Einverständnis zum Auto-Update
In zwei Sätzen erklären, dass der Bot neue Versionen automatisch von GitHub installiert, also Code des Besitzers auf diesem PC läuft. Fragen, ob das okay ist.
- **Ja:** `New-Item -ItemType Directory -Force "$bot\update"; Copy-Item "$bot\release-manifest.json" "$bot\update\installed-manifest.json"`
- **Nein:** `AUTO_UPDATE=false` an die `.env` anhängen.

### 5. Probelauf
`node --env-file=.env src/index.js` ca. 40 s im Hintergrund laufen lassen, `logs\bot.log` lesen, dann beenden. Erwartet: `Bei Discord angemeldet`, `Bot-Besitzer:`, `Auto-Update aktiv` (oder `ausgeschaltet`), `Server ist online`.
- Einladungslink im Log → an den Nutzer für den Besitzer weitergeben.
- `ECONNREFUSED` / `RCON-Passwort ist falsch` → zurück zu Schritt 3.
- `DISCORD_TOKEN ist ungültig` → nicht selbst beheben; der Besitzer muss eine neue `.env` schicken.

### 6. Dauerbetrieb
```powershell
cmd /c "autostart-einrichten.bat" < nul
Start-Process -FilePath "$bot\start-bot.bat" -WorkingDirectory $bot -WindowStyle Minimized
```
Dem Nutzer sagen: Das minimierte Fenster „Minecraft Status-Bot“ muss offen bleiben.

### 7. Neustart-Skript (für `/mc server neustart`)
`server-startskript\start-mit-neustart.bat` in den Serverordner kopieren (vor dem Überschreiben fragen). Die `java …`-Zeile muss der aus der `run.bat` entsprechen – bei Abweichung nur diese Zeile ersetzen, CRLF-Zeilenenden beibehalten. Mit OK des Nutzers Verknüpfungen/Autostart von `run.bat` darauf umstellen. Dem Nutzer sagen: Server ab jetzt mit dieser Datei starten; nach einem Stopp innerhalb von 15 s `N` drücken, damit er aus bleibt. Der gerade laufende Server wechselt beim nächsten Neustart.

**Geplante Neustarts:** In der Windows-Aufgabenplanung nach Aufgaben suchen, die den Server stoppen/starten (`run.bat`, `java`, `taskkill`, `mcrcon`), und sie dem Nutzer zeigen. Eine Aufgabe darf den Server nicht mehr *starten* (das macht das Neustart-Skript – sonst startet er doppelt). Will der Nutzer die geplanten Neustarts stattdessen vom Bot (Countdown im Spiel, sauberes Herunterfahren), die Aufgabe mit seinem OK deaktivieren und `RESTART_SCHEDULE="HH:MM"` in der `.env` setzen.

### 8. Firewall (empfohlen, macht der Nutzer)
Fragen, ob etwas auf einem anderen PC RCON nutzt. Wenn nicht, führt der Nutzer `rcon-firewall-sperren.bat` per Rechtsklick → *Als Administrator ausführen* aus. Danach darf `logs\bot.log` keine neuen RCON-Fehler zeigen.

### 9. Rückmeldung
Node-Version, Bot-Ordner, geänderte `.env`-Einträge (nur Namen), Test- und Log-Ergebnis, Auto-Update an/aus, Autostart, Stand des Neustart-Skripts, Firewall-Regel.
