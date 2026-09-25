import { execFile } from 'node:child_process';
import os from 'node:os';

// Der Bot läuft auf demselben PC wie der Minecraft-Server und kann Windows direkt fragen:
// - seit wann der Serverprozess läuft ("Online seit", auch wenn der Bot einen Neustart verpasst hat)
// - ob der Serverprozess nach "stop" wirklich beendet ist (Hänger-Absicherung beim Neustart)

// Zwischen Prozessstart und Erreichbarkeit liegt das Laden der Mods. Liegt die vom Bot
// beobachtete Zeit weniger als das hinter dem Prozessstart, bleibt die genauere Beobachtung.
const STARTUP_MARGIN_MS = 15 * 60 * 1000;
// Toleranz beim Vergleich von Startzeiten (Rundung) – schützt vor wiederverwendeten Prozess-IDs.
const START_TIME_TOLERANCE_MS = 2000;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

/** Nur wenn MC_HOST dieser PC ist (auch dessen eigene IP, z. B. die Radmin-IP), sind Prozess-Abfragen sinnvoll. */
export function isLocalHost(host) {
  if (LOCAL_HOSTS.has(host)) return true;
  return Object.values(os.networkInterfaces()).flat().some((iface) => iface?.address === host);
}

function powershell(command, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

const isPid = (pid) => Number.isInteger(pid) && pid > 0;

/** Prozess, der auf dem Port lauscht: { pid, startedAt } oder null. */
export async function getListeningProcess(port, { host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(port) || !isLocalHost(host)) return null;
  const out = await powershell(
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; `
    + 'if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction Stop; "$($p.Id)|$($p.StartTime.ToUniversalTime().ToString(\'o\'))" }',
  );
  const [pidText, startText] = String(out ?? '').split('|');
  const pid = Number(pidText);
  const startedAt = Date.parse(startText);
  return isPid(pid) && Number.isFinite(startedAt) ? { pid, startedAt } : null;
}

/** Startzeit (ms) des Prozesses auf dem Port oder null. */
export async function getListeningProcessStart(port, options) {
  return (await getListeningProcess(port, options))?.startedAt ?? null;
}

/**
 * Läuft genau dieser Prozess noch? Prüft zusätzlich die Startzeit, damit eine inzwischen
 * wiederverwendete Prozess-ID nicht als "läuft noch" gilt. null = konnte nicht geprüft werden.
 */
export async function isProcessAlive({ pid, startedAt }) {
  if (!isPid(pid)) return null;
  const out = await powershell(
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().ToString('o') } else { 'gone' }`,
  );
  if (out === null) return null;
  if (out === 'gone') return false;
  const actual = Date.parse(out);
  return Number.isFinite(actual) && Math.abs(actual - startedAt) <= START_TIME_TOLERANCE_MS;
}

/** Beendet den Prozess hart. true = erledigt. */
export async function killProcess({ pid }) {
  if (!isPid(pid)) return false;
  const out = await powershell(`Stop-Process -Id ${pid} -Force -ErrorAction Stop; 'ok'`);
  return out === 'ok';
}

/** Neuer Wert für "Online seit", wenn die Prozess-Startzeit der bisherigen widerspricht, sonst null. */
export function correctedOnlineSince(onlineSince, processStart) {
  if (!processStart) return null;
  if (!onlineSince) return processStart;
  if (processStart > onlineSince) return processStart; // Server wurde neu gestartet, ohne dass der Bot es sah
  if (onlineSince - processStart > STARTUP_MARGIN_MS) return processStart; // Server lief schon länger, als der Bot weiß
  return null;
}
