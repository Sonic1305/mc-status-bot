import { execFile } from 'node:child_process';
import os from 'node:os';

// "Online seit" kennt der Bot sonst nur aus eigener Beobachtung. War er während eines
// Server-Neustarts aus (Bot-Neustart, PC-Neustart), stünde dort eine veraltete Zeit.
// Weil der Bot auf demselben PC läuft, fragt er Windows, seit wann der Prozess läuft,
// der auf dem Minecraft-Port lauscht.

// Zwischen Prozessstart und Erreichbarkeit liegt das Laden der Mods. Liegt die vom Bot
// beobachtete Zeit weniger als das hinter dem Prozessstart, bleibt die genauere Beobachtung.
const STARTUP_MARGIN_MS = 15 * 60 * 1000;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

/** Nur wenn MC_HOST dieser PC ist (auch dessen eigene IP, z. B. die Radmin-IP), ist der Abgleich sinnvoll. */
export function isLocalHost(host) {
  if (LOCAL_HOSTS.has(host)) return true;
  return Object.values(os.networkInterfaces()).flat().some((iface) => iface?.address === host);
}

/**
 * Startzeit (ms) des Prozesses, der auf dem Port lauscht – oder null
 * (kein Windows, kein lauschender Prozess, keine Berechtigung).
 */
export function getListeningProcessStart(port, { host = '127.0.0.1', timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !Number.isInteger(port) || !isLocalHost(host)) {
      resolve(null);
      return;
    }
    const command = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; `
      + 'if ($c) { (Get-Process -Id $c.OwningProcess -ErrorAction Stop).StartTime.ToUniversalTime().ToString("o") }';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        const ms = Date.parse(String(stdout).trim());
        resolve(err || !Number.isFinite(ms) ? null : ms);
      });
  });
}

/** Neuer Wert für "Online seit", wenn die Prozess-Startzeit der bisherigen widerspricht, sonst null. */
export function correctedOnlineSince(onlineSince, processStart) {
  if (!processStart) return null;
  if (!onlineSince) return processStart;
  if (processStart > onlineSince) return processStart; // Server wurde neu gestartet, ohne dass der Bot es sah
  if (onlineSince - processStart > STARTUP_MARGIN_MS) return processStart; // Server lief schon länger, als der Bot weiß
  return null;
}
