# Update auf Version 1.2 – einmalig von Hand, danach automatisch

## Für den Hoster (Mensch)

1. Das Zip `mc-status-bot-v1.2.x.zip` (z. B. `mc-status-bot-v1.2.1.zip`) in den **Bot-Ordner** legen (dort, wo `start-bot.bat` und `.env` liegen).
2. Claude Code in diesem Ordner öffnen und sagen:
   **„Lies die UPDATE.md aus dem Zip mc-status-bot-v1.2.x.zip und spiel das Update ein.“**

Deine `.env` und `state.json` bleiben erhalten – das Zip enthält sie nicht.

**Neu ab v1.2 – bitte lesen:** Der Bot aktualisiert sich künftig **selbst** von GitHub (github.com/<repo aus package.json>). Der Bot-Besitzer veröffentlicht dort neue Versionen, dein PC installiert sie automatisch. Das heißt: Code, den der Bot-Besitzer veröffentlicht, läuft auf deinem PC. Willst du das nicht, sag es Claude beim Update – dann wird `AUTO_UPDATE=false` gesetzt und du aktualisierst weiterhin von Hand.

---

## Für Claude – Update-Auftrag

Auf diesem PC läuft der Minecraft Status-Bot in Version 1.0 oder 1.1 (Ordner mit `start-bot.bat`, `src\`, `.env`). Version 1.2 bringt:

- **Auto-Update:** Der Bot prüft alle 6 h das neueste GitHub-Release, prüft die SHA-256-Prüfsummen, installiert es und startet sich neu. Stürzt die neue Version ab, stellt `start-bot.bat` die alte wieder her.
- `/server neustart` (seit 1.1): Der Bot-Besitzer kann den Minecraft-Server per Discord neu starten.
- „Server offline“-Meldungen erst nach 10 Min. Ausfall.

Details: `README.md`, Abschnitte „Automatische Updates“, „9. Startskript für Neustarts“ und „Server-Neustart per Discord“.

### Regeln

- **Geheimnisse nie ausgeben:** `.env` enthält Bot-Token und RCON-Passwort. Nicht anzeigen. Einzige erlaubte Änderung in diesem Update: `AUTO_UPDATE=false` ergänzen, falls der Nutzer keine automatischen Updates will.
- **`.env` und `state.json` nicht überschreiben oder löschen.**
- **Den Minecraft-Server nicht stoppen oder neu starten**, außer der Nutzer erlaubt es ausdrücklich.
- **Kein Code in `src\` ändern.**

### Schritt 1 – Bot-Ordner prüfen

Prüf im aktuellen Ordner, dass `start-bot.bat`, `src\index.js` und `.env` existieren (`.env` nur auf Existenz prüfen). `$bot` = voller Pfad des Bot-Ordners. Die installierte Version steht in `package.json` (`"version"`).

### Schritt 2 – Auto-Update mit dem Nutzer klären

Erklär dem Nutzer in zwei Sätzen, dass der Bot sich ab jetzt automatisch von GitHub aktualisiert und dass damit Code des Bot-Besitzers automatisch auf diesem PC ausgeführt wird. Frag, ob das in Ordnung ist. Wenn **nein**: am Ende der `.env` eine Zeile `AUTO_UPDATE=false` anhängen (UTF-8 ohne BOM, sonst nichts ändern).

### Schritt 3 – Bot beenden

**Wichtig:** Diesmal wird auch `start-bot.bat` ersetzt – das geht nur, wenn sie nicht läuft.

Am saubersten: den Nutzer bitten, das Fenster **„Minecraft Status-Bot“** zu schließen. Sonst beenden – **zuerst** das Startfenster, dann den Bot:

```powershell
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*start-bot.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Kontrolle: Beide Abfragen ohne `Stop-Process` erneut ausführen – es darf nichts mehr gefunden werden.

### Schritt 4 – Dateien einspielen

```powershell
Expand-Archive -Path (Get-ChildItem "$bot\mc-status-bot-v*.zip" | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -DestinationPath $bot -Force
```

Das Zip enthält die Dateien direkt (ohne Unterordner). Danach muss `package.json` eine Version **1.2.1 oder höher** enthalten und `src\updater.js` existieren. Dann:

```powershell
npm install --omit=dev --no-audit --no-fund
npm test
```

`npm test` muss **34 bestandene Tests** melden (`# pass 34`, `# fail 0`).

Damit der Updater künftig auch entfernte Dateien aufräumen kann, den Stand festhalten:

```powershell
New-Item -ItemType Directory -Force "$bot\update" | Out-Null
Copy-Item "$bot\release-manifest.json" "$bot\update\installed-manifest.json" -Force
```

### Schritt 5 – Startskript im Serverordner (falls noch nicht vorhanden)

Prüf, ob im **Serverordner** (dort liegen `server.properties`, `mods\`, `run.bat`) bereits `start-mit-neustart.bat` liegt. Wenn nicht, einrichten wie in `HOSTER-INSTALLATION.md` unter „Schritt 5b – Startskript für `/server neustart`“ beschrieben (Vorlage: `server-startskript\start-mit-neustart.bat`, Java-Zeile mit `run.bat` abgleichen, Verknüpfungen nur mit OK umstellen).

### Schritt 6 – Bot wieder starten

```powershell
Start-Process -FilePath "$bot\start-bot.bat" -WorkingDirectory $bot -WindowStyle Minimized
```

Nach ca. 20 Sekunden `logs\bot.log` prüfen. Erwartet:

```
INFO   Minecraft Status-Bot v1.2.x startet …
INFO   Bei Discord angemeldet als <Botname>.
INFO   /server neustart erlaubt für: <Name> (<ID>).
INFO   Auto-Update aktiv: prüft github.com/<repo> alle 6 h.      (oder: "Auto-Update ist ausgeschaltet")
INFO   Server läuft weiterhin.        (oder: "Server ist online.")
```

### Schritt 7 – Rückmeldung an den Nutzer

Kurz zusammenfassen (für den Bot-Besitzer):
- Update eingespielt (Version aus `package.json`), Testergebnis, relevante Log-Zeilen (ohne Geheimnisse)
- Auto-Update: an oder aus (auf Wunsch des Hosters)
- Startskript im Serverordner: vorhanden / neu eingerichtet / ausstehend; ob der Server schon darüber läuft
