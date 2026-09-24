import { readFileSync } from 'node:fs';
import { parseSchedule } from './schedule.js';

// Liest die Einstellungen aus der .env (Node lädt sie über --env-file).
const env = process.env;
const problems = [];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function str(name, fallback = '') {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function num(name, fallback, { min = -Infinity, max = Infinity, integer = true } = {}) {
  const raw = str(name);
  if (raw === '') return fallback;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    problems.push(`${name}="${raw}" ist ungültig (erlaubt: ${integer ? 'ganze Zahl ' : ''}${min} bis ${max}).`);
    return fallback;
  }
  return value;
}

function bool(name, fallback) {
  const raw = str(name).toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'ja', 'yes', 'an', 'on'].includes(raw)) return true;
  if (['false', '0', 'nein', 'no', 'aus', 'off'].includes(raw)) return false;
  problems.push(`${name}="${raw}" ist ungültig (erlaubt: true oder false).`);
  return fallback;
}

function idList(name) {
  const ids = str(name).split(/[\s,;]+/).filter(Boolean);
  const invalid = ids.filter((id) => !/^\d{17,20}$/.test(id));
  if (invalid.length) problems.push(`${name}: "${invalid.join(', ')}" ist keine Discord-User-ID (17–20 Ziffern).`);
  return ids.filter((id) => !invalid.includes(id));
}

function scriptName(name, fallback) {
  const value = str(name, fallback);
  // Wird in einen PowerShell-Befehl eingesetzt – daher nur einfache Dateinamen zulassen.
  if (!/^[\w .-]+\.(bat|cmd)$/i.test(value)) {
    problems.push(`${name}="${value}" muss ein einfacher Dateiname sein, z. B. start-mit-neustart.bat.`);
    return fallback;
  }
  return value;
}

function repoSlug(name, fallback) {
  const value = str(name, fallback);
  if (value && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    problems.push(`${name}="${value}" muss die Form "besitzer/repo" haben.`);
    return fallback;
  }
  return value;
}

function schedule(name) {
  try {
    return parseSchedule(str(name));
  } catch (err) {
    problems.push(`${name}: ${err.message} (Beispiel: "04:00" oder "04:00,16:00").`);
    return [];
  }
}

function timezone(name, fallback) {
  const tz = str(name, fallback);
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: tz });
    return tz;
  } catch {
    problems.push(`${name}="${tz}" ist keine gültige Zeitzone (z. B. Europe/Berlin).`);
    return fallback;
  }
}

export const config = {
  discordToken: str('DISCORD_TOKEN'),

  mcHost: str('MC_HOST', '127.0.0.1'),
  mcPort: num('MC_PORT', 25565, { min: 1, max: 65535 }),
  rconPort: num('RCON_PORT', 25575, { min: 1, max: 65535 }),
  rconPassword: str('RCON_PASSWORD'),

  serverName: str('SERVER_NAME', 'Minecraft-Server'),
  versionText: str('VERSION_TEXT'),
  radminNetwork: str('RADMIN_NETWORK'),
  radminPassword: str('RADMIN_PASSWORD'),
  connectAddress: str('CONNECT_ADDRESS'),
  showTps: bool('SHOW_TPS', true),

  pollIntervalSec: num('POLL_INTERVAL_SECONDS', 15, { min: 5, max: 300 }),
  heartbeatSec: num('HEARTBEAT_SECONDS', 60, { min: 30, max: 3600 }),
  offlineAfterFails: num('OFFLINE_AFTER_FAILS', 3, { min: 1, max: 20 }),

  offlineAlertMinutes: num('OFFLINE_ALERT_MINUTES', 10, { min: 0, max: 240 }),
  timezone: timezone('TIMEZONE', 'Europe/Berlin'),

  // Neustart per /server neustart
  ownerIds: idList('OWNER_IDS'), // leer = Besitzer der Discord-Application
  restartScriptName: scriptName('RESTART_SCRIPT_NAME', 'start-mit-neustart.bat'),
  restartTimeoutMinutes: num('RESTART_TIMEOUT_MINUTES', 10, { min: 3, max: 60 }),
  restartCooldownMinutes: num('RESTART_COOLDOWN_MINUTES', 5, { min: 0, max: 120 }),
  restartSchedule: schedule('RESTART_SCHEDULE'), // leer = keine geplanten Neustarts
  restartScheduleCountdown: num('RESTART_SCHEDULE_COUNTDOWN_MINUTES', 5, { min: 0, max: 30 }),

  // Auto-Update von GitHub
  version: pkg.version,
  autoUpdate: bool('AUTO_UPDATE', true),
  updateRepo: repoSlug('UPDATE_REPO', pkg.updateRepo ?? ''),
  updateCheckHours: num('UPDATE_CHECK_HOURS', 6, { min: 1, max: 168 }),
};

const isPlaceholder = (value) => /^HIER_/i.test(value);

export function validateConfig() {
  const errors = [...problems];
  const warnings = [];

  if (!config.discordToken || isPlaceholder(config.discordToken)) {
    errors.push('DISCORD_TOKEN fehlt – Bot-Token aus dem Discord Developer Portal in die .env eintragen.');
  }
  if (isPlaceholder(config.rconPassword)) {
    errors.push('RCON_PASSWORD ist noch der Platzhalter – rcon.password aus der server.properties eintragen (oder leer lassen, um ohne RCON zu laufen).');
  } else if (!config.rconPassword) {
    warnings.push('RCON_PASSWORD ist leer – der Bot nutzt nur den Status-Ping. Dann werden höchstens 12 Spielernamen angezeigt und keine TPS.');
  }
  return { errors, warnings };
}
