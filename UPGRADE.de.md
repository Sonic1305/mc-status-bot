# Upgrade

[🇬🇧 English](UPGRADE.md) · 🇩🇪 Deutsch

## 1.2 → 1.3 (automatisch)

Nichts zu tun – der Bot installiert 1.3 selbst. Die `.env` funktioniert unverändert weiter:

- **Sprache:** 1.3 spricht standardmäßig Englisch, Installationen von vor 1.3 **bleiben aber deutsch** (gemerkt in der `state.json`). `LANGUAGE="en"` in der `.env` stellt auf Englisch um.
- **Neustart-Skript:** Solche Installationen erwarten weiterhin `start-mit-neustart.bat`. Neue Installationen nutzen `server-script/start-with-restart.bat`.
- `RADMIN_NETWORK` / `RADMIN_PASSWORD` funktionieren weiter (neue allgemeine Namen: `VPN_NETWORK` / `VPN_PASSWORD` / `VPN_NAME`).
- Die Hilfsskripte heißen jetzt englisch: `autostart-enable.bat`, `autostart-disable.bat`, `block-rcon-firewall.bat`. Eine bestehende Autostart-Verknüpfung oder Firewall-Regel funktioniert weiter.
- Neue optionale Einstellungen (Anzeige-Teile, Meldungsarten, Admin-Rollen, TPS für Paper/Forge/Vanilla, …): siehe [`.env.example`](.env.example) und `/mc bot info`.

## 1.0 / 1.1 → 1.2 (einmalig, von Hand)

Ab Version 1.2 aktualisiert sich der Bot selbst. Hoster mit einer älteren Version brauchen dieses eine manuelle Upgrade.

### Für den Hoster

1. Das Zip `mc-status-bot-v1.2.x.zip` in den **Bot-Ordner** legen (dort, wo `start-bot.bat` und `.env` liegen).
2. Claude Code dort öffnen und sagen: **„Lies UPGRADE.de.md aus dem Zip und spiel das Upgrade ein.“**

`.env` und `state.json` bleiben erhalten. Neu: Der Bot installiert danach neue Versionen automatisch von GitHub – sag Bescheid, wenn du das nicht willst.

### Für Claude

**Regeln:** Nie Geheimnisse aus der `.env` ausgeben; `.env` und `state.json` nicht überschreiben; den Minecraft-Server nicht ohne ausdrückliches OK stoppen/neu starten; keinen Code in `src/` ändern. Einzige erlaubte Änderung an der `.env`: `AUTO_UPDATE=false` anhängen.

1. **Prüfen:** `start-bot.bat`, `src\index.js` und `.env` existieren im aktuellen Ordner (`$bot`). Die aktuelle Version steht in `package.json`.
2. **Einverständnis:** In zwei Sätzen erklären, dass der Bot neue Versionen automatisch von GitHub installiert (Code des Besitzers läuft auf diesem PC). Lehnt der Nutzer ab, `AUTO_UPDATE=false` an die `.env` anhängen (UTF-8 ohne BOM).
3. **Bot beenden** – `start-bot.bat` wird ersetzt und darf nicht laufen. Am besten den Nutzer bitten, das Fenster „Minecraft Status-Bot“ zu schließen. Sonst zuerst das Startfenster, dann den Bot beenden:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | ? { $_.CommandLine -like '*start-bot.bat*' } | % { Stop-Process -Id $_.ProcessId -Force }
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*src*index.js*' } | % { Stop-Process -Id $_.ProcessId -Force }
   ```
4. **Installieren** (das Zip hat keinen Unterordner):
   ```powershell
   Expand-Archive -Path (Get-ChildItem "$bot\mc-status-bot-v*.zip" | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -DestinationPath $bot -Force
   npm install --omit=dev --no-audit --no-fund
   npm test          # muss mit "# fail 0" enden
   New-Item -ItemType Directory -Force "$bot\update"; Copy-Item "$bot\release-manifest.json" "$bot\update\installed-manifest.json" -Force
   ```
   `package.json` muss jetzt Version 1.2.1 oder höher zeigen und `src\updater.js` muss existieren.
5. **Neustart-Skript:** Fehlt im Serverordner noch ein Neustart-Skript, wie in [INSTALL.de.md](INSTALL.de.md), Schritt 7 einrichten.
6. **Starten:** `Start-Process -FilePath "$bot\start-bot.bat" -WorkingDirectory $bot -WindowStyle Minimized`. Nach ca. 20 s sollte `logs\bot.log` die neue Version, `Bei Discord angemeldet`, `Auto-Update aktiv` (oder `ausgeschaltet`) und den Serverstatus zeigen.
7. **Rückmeldung:** installierte Version, Testergebnis, Auto-Update an/aus, Stand des Neustart-Skripts.
