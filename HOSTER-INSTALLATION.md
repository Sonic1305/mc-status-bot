# Installation des Minecraft Status-Bots auf dem Host-PC

## Für den Hoster (Mensch) – das musst du tun

1. Das Zip auf dem PC entpacken, auf dem auch der Minecraft-Server läuft, z. B. nach `C:\Gameserver\mc-status-bot`.
2. Die Datei **`.env`**, die du separat bekommen hast, in diesen Ordner legen (neben `README.md`). Achtung: Windows blendet den Punkt am Anfang gern aus oder hängt `.txt` an. Der Name muss exakt `.env` lauten.
3. **Claude Code** in diesem Ordner öffnen.
4. Claude sagen: **„Lies HOSTER-INSTALLATION.md und richte den Bot ein.“**
5. Claude fragt zwischendurch nach, z. B. wo dein Minecraft-Server liegt. Ein Schritt am Ende (Firewall) braucht Administratorrechte, den machst du selbst per Rechtsklick.

> 🔒 Die Datei `.env` in diesem Ordner enthält den Discord-Bot-Token und das RCON-Passwort. Nicht weitergeben, nicht in Discord posten, nicht in Screenshots zeigen.

> ⬆️ **Automatische Updates:** Der Bot aktualisiert sich selbst von GitHub, wenn der Bot-Besitzer dort eine neue Version veröffentlicht. Code des Bot-Besitzers läuft dann automatisch auf deinem PC. Willst du das nicht, sag es Claude bei der Einrichtung – dann bleiben Updates aus.

---

## Für Claude – Installationsauftrag

Du richtest auf diesem Windows-PC einen fertigen Discord-Bot ein. Der Bot zeigt in einem Discord-Channel live an, ob der Minecraft-Server (TNP Limitless 8, NeoForge 1.21.1) läuft und wer online ist. Er läuft als Node.js-Prozess auf **demselben PC wie der Minecraft-Server** und fragt diesen lokal per RCON und Status-Ping ab. Der Code ist fertig und getestet. Deine Aufgabe ist nur Installation, Abgleich der Konfiguration, Probelauf und Dauerbetrieb.

Hintergrund zum Bot (Funktionen, Befehle, Fehlerbehebung) steht in `README.md` in diesem Ordner.

### Regeln

- **Geheimnisse nie ausgeben.** `.env` enthält `DISCORD_TOKEN`, `RCON_PASSWORD` und evtl. `RADMIN_PASSWORD`. Gib deren Werte nie im Chat oder in Befehlsausgaben aus. Beim Vergleichen nur „stimmt / stimmt nicht“ melden. Lies `.env` nicht mit `cat`/`Get-Content` ohne Maskierung.
- **`DISCORD_TOKEN` nicht ändern.** Er gehört dem Besitzer des Bots und ist korrekt.
- **Code in `src/` nicht ändern.**
- **Minecraft-Server nicht stoppen oder neu starten und `server.properties` nicht ändern**, außer der Nutzer erlaubt es ausdrücklich. Es können Spieler online sein.
- **Keine Firewall-Ports öffnen.** Der Bot baut nur ausgehende Verbindungen zu Discord auf und braucht keinen eingehenden Port.
- **Pro Bot-Token darf nur eine Instanz laufen.** Frag vor dem Probelauf, ob der Bot sonst noch irgendwo läuft (z. B. beim Besitzer zum Testen). Wenn ja, muss er dort zuerst beendet werden.

### Schritt 1 – Voraussetzungen prüfen

1. `node -v` ausführen. Nötig ist **v20.6 oder neuer**.
   - Fehlt Node.js oder ist es zu alt: Frag den Nutzer, ob du `winget install OpenJS.NodeJS.LTS` ausführen sollst (alternativ installiert er die LTS-Version selbst von https://nodejs.org). Danach ist eine neue Shell nötig, damit `node` im PATH ist.
2. Prüf, dass der Bot-Ordner eine `.env` enthält (nur Existenz prüfen, nicht ausgeben). Sie wird getrennt vom Zip übergeben. Fehlt sie, gibt es aber z. B. `.env.txt` oder `env`, dann umbenennen. Fehlt sie ganz, den Nutzer bitten, die Datei vom Besitzer in den Ordner zu legen. **Nicht** aus `.env.example` neu anlegen, denn der Token kommt vom Besitzer.
3. Frag nach dem Ordner des Minecraft-Servers, also dem Ordner mit `server.properties`, `mods/` und `run.bat`. Wenn der Nutzer es nicht weiß: nach `server.properties` suchen, deren `motd` „TNP Limitless 8“ enthält.
4. `ipconfig` ausführen und die IPv4-Adresse des Adapters **„Radmin VPN“** notieren (beginnt mit `26.`).

### Schritt 2 – Abhängigkeiten installieren und testen

Im Bot-Ordner:

```powershell
npm install --omit=dev --no-audit --no-fund
npm test
```

`npm test` muss **34 bestandene Tests** melden (`# pass 34`, `# fail 0`). Die Tests brauchen keinen Server und kein Discord.

### Schritt 3 – `.env` mit dem Server abgleichen

Die `.env` wurde vom Besitzer auf einem anderen PC ausgefüllt. Folgendes Skript vergleicht sie mit der `server.properties`, ohne Geheimnisse auszugeben. Die beiden Pfade anpassen:

```powershell
$server = 'C:\PFAD\ZUM\MINECRAFT-SERVER'
$bot    = 'C:\PFAD\ZUM\mc-status-bot'
function Read-KeyValues($file) {
  $h = @{}
  Get-Content $file | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2; $h[$k.Trim()] = $v.Trim().Trim('"')
  }
  $h
}
$p = Read-KeyValues "$server\server.properties"
$e = Read-KeyValues "$bot\.env"
[pscustomobject]@{
  'enable-rcon (muss true sein)' = $p['enable-rcon']
  'server-ip (leer ist normal)'  = $p['server-ip']
  'MC_HOST in .env'              = $e['MC_HOST']
  'MC_PORT passt'                = $e['MC_PORT'] -eq $p['server-port']
  'RCON_PORT passt'              = $e['RCON_PORT'] -eq $p['rcon.port']
  'RCON_PASSWORD passt'          = $e['RCON_PASSWORD'] -eq $p['rcon.password']
  'CONNECT_ADDRESS in .env'      = $e['CONNECT_ADDRESS']
} | Format-List
```

So wertest du das Ergebnis aus:

| Prüfung | Soll | Wenn nicht |
|---|---|---|
| `enable-rcon` | `true` | **Stopp, Nutzer fragen.** Zum Aktivieren muss in `server.properties` `enable-rcon=true` und ein `rcon.password` stehen, und der Server muss neu starten. Beides nur mit ausdrücklichem OK. Danach die `.env` erneut abgleichen. |
| `MC_HOST` | `127.0.0.1`, wenn `server-ip` leer ist. Sonst genau der Wert von `server-ip`. | Anpassen (siehe unten). Der Besitzer hat die Radmin-IP eingetragen, weil er die Datei auf einem anderen PC ausgefüllt hat. Auf dem Host ist `127.0.0.1` richtig: Das funktioniert auch, wenn Radmin gerade getrennt ist, und verträgt sich mit der Firewall-Regel aus Schritt 6. **Diese Änderung ist vom Besitzer gewollt.** |
| `MC_PORT` / `RCON_PORT` passt | `True` | Wert aus `server-port` bzw. `rcon.port` in die `.env` übernehmen |
| `RCON_PASSWORD` passt | `True` | Wert aus `rcon.password` in die `.env` übernehmen (siehe unten). Die Werte der `server.properties` sind maßgeblich. |
| `CONNECT_ADDRESS` | `<Radmin-IP aus Schritt 1>:<server-port>` | Korrigieren. Das ist die Adresse, die Spieler in Discord angezeigt bekommen. |

Werte in der `.env` ändern, ohne sie auszugeben. Die Datei als UTF-8 **ohne** BOM speichern:

```powershell
$envFile = "$bot\.env"
$serverHost = if ([string]::IsNullOrWhiteSpace($p['server-ip'])) { '127.0.0.1' } else { $p['server-ip'] }
$lines = Get-Content $envFile -Encoding UTF8 | ForEach-Object {
  if     ($_ -like 'MC_HOST=*')       { 'MC_HOST="' + $serverHost + '"' }
  elseif ($_ -like 'RCON_PASSWORD=*') { 'RCON_PASSWORD="' + $p['rcon.password'] + '"' }
  elseif ($_ -like 'RCON_PORT=*')     { 'RCON_PORT=' + $p['rcon.port'] }
  elseif ($_ -like 'MC_PORT=*')       { 'MC_PORT=' + $p['server-port'] }
  else { $_ }
}
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding $false))
```

`CONNECT_ADDRESS` bei Bedarf auf dieselbe Art setzen. Danach das Vergleichsskript noch einmal laufen lassen, bis alles passt.

Hinweis: Enthält `rcon.password` Sonderzeichen wie `\`, `:` oder `=`, kann die `server.properties` sie escaped speichern (z. B. `\:`). Wenn der Probelauf dann „RCON-Passwort ist falsch“ meldet, ist das die wahrscheinliche Ursache. Dann den Nutzer bitten, ein Passwort nur aus Buchstaben und Ziffern zu setzen.

### Schritt 3b – Auto-Update klären

Der Bot installiert neue Versionen automatisch aus seinem GitHub-Repository (siehe `README.md`, „Automatische Updates“). Erklär dem Nutzer in zwei Sätzen, dass damit Code des Bot-Besitzers automatisch auf diesem PC ausgeführt wird, und frag, ob das in Ordnung ist.

- **Ja:** nichts zu tun (Standard). Damit der Updater später auch entfernte Dateien aufräumen kann, den Stand festhalten:
  ```powershell
  New-Item -ItemType Directory -Force "$bot\update" | Out-Null
  Copy-Item "$bot\release-manifest.json" "$bot\update\installed-manifest.json" -Force
  ```
- **Nein:** am Ende der `.env` eine Zeile `AUTO_UPDATE=false` anhängen (UTF-8 ohne BOM, sonst nichts ändern).

### Schritt 4 – Probelauf

Vorher sicherstellen, dass der Bot nirgends sonst läuft (siehe Regeln).

Den Bot im Bot-Ordner als **Hintergrundprozess** starten, ungefähr 40 Sekunden warten, dann `logs\bot.log` lesen und den Prozess wieder beenden:

```powershell
node --env-file=.env src/index.js
```

Das Log sollte ungefähr so aussehen:

```
INFO   Minecraft Status-Bot v1.2.x startet …
INFO   Bei Discord angemeldet als <Botname>.
INFO   /server neustart erlaubt für: <Name> (<ID>).
INFO   Frage 127.0.0.1:25565 alle 15 s ab (RCON-Port 25575).
INFO   Auto-Update aktiv: prüft github.com/<repo> alle 6 h.   (oder: "Auto-Update ist ausgeschaltet")
INFO   Server ist online.            (oder: "Server läuft weiterhin.")
```

So wertest du das Log aus:

| Log-Zeile | Bedeutung / Aktion |
|---|---|
| `Der Bot ist noch auf keinem Discord-Server. Mit diesem Link einladen: …` | Normal, wenn der Besitzer ihn noch nicht eingeladen hat. Den Link dem Nutzer geben, der ihn an den Besitzer weiterreicht. |
| `Noch kein Status-Channel gesetzt …` | Normal. Der Besitzer führt später in Discord `/statusbot setup` aus. |
| `RCON-Abfrage fehlgeschlagen: Keine Verbindung … (ECONNREFUSED)` | RCON ist aus, der Port stimmt nicht, oder `MC_HOST` passt nicht zu `server-ip`. Zurück zu Schritt 3. |
| `RCON-Passwort ist falsch` | `RCON_PASSWORD` stimmt nicht mit `rcon.password` überein, siehe Schritt 3 |
| `Server ist offline bzw. nicht erreichbar` | Läuft der Minecraft-Server überhaupt? `MC_HOST`/`MC_PORT` prüfen. |
| `DISCORD_TOKEN ist ungültig` | **Nicht selbst beheben.** Dem Nutzer sagen, dass der Besitzer einen neuen Token erzeugen und eine neue `.env` schicken muss. |

Das harte Beenden des Probelaufs ist unproblematisch. Die Discord-Anzeige wird beim nächsten Start sofort korrigiert.

### Schritt 5 – Autostart und Dauerbetrieb

1. Autostart einrichten. Das legt eine Verknüpfung im Windows-Autostart-Ordner an, die den Bot bei jeder Anmeldung minimiert startet:
   ```powershell
   cmd /c "autostart-einrichten.bat" < nul
   ```
   Prüfen, dass `"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Minecraft Status-Bot.lnk"` existiert.
2. Den Bot jetzt dauerhaft in einem **eigenen Fenster** starten, unabhängig von dieser Claude-Sitzung:
   ```powershell
   Start-Process -FilePath "$bot\start-bot.bat" -WorkingDirectory $bot -WindowStyle Minimized
   ```
   `start-bot.bat` startet den Bot nach einem Absturz automatisch neu. Nach ungefähr 20 Sekunden `logs\bot.log` prüfen: Es muss wieder „Bei Discord angemeldet“ und „Server ist online“ bzw. „Server läuft weiterhin“ erscheinen.
3. Dem Nutzer sagen: In der Taskleiste gibt es jetzt ein minimiertes Fenster **„Minecraft Status-Bot“**. Es **nicht schließen**, denn das beendet den Bot.

### Schritt 5b – Startskript für `/server neustart`

Der Bot-Besitzer kann den Server per Discord neu starten. Der Bot schickt dafür nur RCON `stop`. Wieder hochfahren muss den Server ein Startskript mit Schleife.

1. `server-startskript\start-mit-neustart.bat` aus dem Bot-Ordner in den **Serverordner** kopieren (neben `run.bat`). Existiert dort schon eine gleichnamige Datei: dem Nutzer zeigen und nur mit OK ersetzen.
2. **Java-Zeile abgleichen:** Die Zeile, die mit `java ` beginnt, muss exakt der `java`-Zeile aus der `run.bat` des Servers entsprechen (die Vorlage enthält NeoForge `21.1.250`). Weicht sie ab, nur diese Zeile ersetzen. Die Datei muss mit Windows-Zeilenenden (CRLF) gespeichert bleiben.
3. Den Nutzer fragen, wie der Server bisher gestartet wird (Doppelklick auf `run.bat`, Verknüpfung, Autostart, Aufgabenplanung). Verknüpfungen oder Autostart-Einträge, die auf `run.bat` zeigen, **mit OK des Nutzers** auf `start-mit-neustart.bat` umstellen.
4. Dem Nutzer erklären:
   - Ab jetzt den Server mit `start-mit-neustart.bat` starten. Nach jedem Beenden startet er nach 15 Sekunden neu.
   - **Dauerhaft aus:** in diesen 15 Sekunden `N` drücken oder das Fenster schließen.
   - Der gerade laufende Server wurde noch über `run.bat` gestartet. Bei nächster Gelegenheit (z. B. wenn niemand online ist) einmal normal stoppen und über das neue Skript starten. Bis dahin warnt der Bot bei `/server neustart`, dass der Server sonst aus bliebe. Den Server nur mit ausdrücklichem OK des Nutzers selbst neu starten.

### Schritt 6 – RCON-Port absichern (empfohlen, der Nutzer macht es selbst)

Im Radmin-Netz kann jedes Mitglied die Ports dieses PCs erreichen, also auch RCON (Standard 25575). Wer das RCON-Passwort kennt, hat damit volle Admin-Rechte auf dem Server.

1. Frag den Nutzer, ob irgendein Programm auf einem **anderen** PC RCON nutzt (z. B. ein Admin-Tool). Wenn ja, diesen Schritt überspringen und das in der Rückmeldung erwähnen.
2. Wenn nein: Der Nutzer führt `rcon-firewall-sperren.bat` per **Rechtsklick → Als Administrator ausführen** aus. Führ das nicht selbst mit erhöhten Rechten aus. Das Skript sperrt nur den RCON-Port für eingehende Verbindungen von außen. Lokale Verbindungen (`127.0.0.1`) filtert die Windows-Firewall nicht.
3. Danach 30 Sekunden warten und `logs\bot.log` prüfen: Es darf kein neues `RCON-Abfrage fehlgeschlagen` auftauchen. Falls doch (möglich, wenn `MC_HOST` nicht `127.0.0.1` ist), die Regel wieder entfernen (Admin-Konsole):
   `netsh advfirewall firewall delete rule name="Minecraft RCON von aussen sperren"`

### Schritt 7 – Rückmeldung an den Nutzer

Fass für den Nutzer zusammen, damit er es an den Besitzer weitergeben kann:

- Node.js-Version und Pfad des Bot-Ordners
- welche `.env`-Einträge du geändert hast (**nur die Namen, keine Werte**)
- Ergebnis von `npm test` und vom Probelauf (die relevanten Log-Zeilen ohne Geheimnisse)
- Autostart eingerichtet: ja/nein. Firewall-Regel gesetzt: ja/nein/übersprungen.
- Auto-Update: an oder aus (auf Wunsch des Hosters).
- Startskript `start-mit-neustart.bat`: Pfad, ob die Java-Zeile angepasst wurde, welche Verknüpfungen umgestellt wurden, ob der Server schon darüber läuft.
- Nächster Schritt für den Besitzer in Discord: `/statusbot setup kanal:#…` (falls noch nicht passiert), optional `/statusbot alarm kanal:#… rolle:@…`. Zur Kontrolle zeigt `/statusbot info` „RCON: ✅ verbunden“.

### Später: Updates

Mit Auto-Update passiert das von selbst. Ist `AUTO_UPDATE=false` gesetzt und schickt der Besitzer eine neue Version:
1. Das Fenster „Minecraft Status-Bot“ schließen.
2. Alle Dateien ersetzen, **außer** `.env` und `state.json`.
3. `npm install --omit=dev` ausführen.
4. Den Bot wie in Schritt 5.2 wieder starten.
