import { readFileSync } from 'node:fs';
import { DEFAULT_LANGUAGE, LANGUAGES, t } from './i18n.js';
import { parseSchedule } from './schedule.js';

// Liest die Einstellungen aus der .env (Node lädt sie über --env-file).
// Jede Einstellung hat einen Standard – fehlt sie in der .env, gilt der Standard.
const env = process.env;
// Probleme werden erst in validateConfig() übersetzt: Die Sprache steht beim Einlesen noch nicht fest.
const problems = [];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const DEFAULT_RESTART_SCRIPT = 'start-with-restart.bat';
export const TPS_COMMANDS = ['auto', 'neoforge', 'forge', 'paper', 'vanilla'];

function str(name, fallback = '') {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function num(name, fallback, { min = -Infinity, max = Infinity, integer = true } = {}) {
  const raw = str(name);
  if (raw === '') return fallback;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    problems.push(() => t('config.invalidNumber', { name, raw, min, max, integer }));
    return fallback;
  }
  return value;
}

function bool(name, fallback) {
  const raw = str(name).toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'ja', 'yes', 'an', 'on'].includes(raw)) return true;
  if (['false', '0', 'nein', 'no', 'aus', 'off'].includes(raw)) return false;
  problems.push(() => t('config.invalidBool', { name, raw }));
  return fallback;
}

function idList(name) {
  const ids = str(name).split(/[\s,;]+/).filter(Boolean);
  const invalid = ids.filter((id) => !/^\d{17,20}$/.test(id));
  if (invalid.length) problems.push(() => t('config.invalidIds', { name, ids: invalid.join(', ') }));
  return ids.filter((id) => !invalid.includes(id));
}

function choice(name, fallback, allowed) {
  const raw = str(name).toLowerCase();
  if (raw === '') return fallback;
  if (!allowed.includes(raw)) {
    problems.push(() => t('config.invalidChoice', { name, raw, allowed: allowed.join(', ') }));
    return fallback;
  }
  return raw;
}

/** Text, in dem \n für einen Zeilenumbruch steht. */
const multiline = (name) => str(name).replace(/\\n/g, '\n');

function url(name) {
  const value = str(name);
  if (value && !/^https?:\/\/\S+$/i.test(value)) {
    problems.push(() => t('config.invalidUrl', { name, raw: value }));
    return '';
  }
  return value;
}

const LANGUAGE_ALIASES = { english: 'en', deutsch: 'de', german: 'de' };

/** undefined = nicht gesetzt (dann entscheidet applyStoredDefaults bzw. der Standard). */
function language(name) {
  const raw = str(name).toLowerCase();
  if (raw === '') return undefined;
  const code = LANGUAGE_ALIASES[raw] ?? raw.split(/[-_]/)[0];
  if (!LANGUAGES[code]) {
    problems.push(() => t('config.invalidChoice', { name, raw, allowed: Object.keys(LANGUAGES).join(', ') }));
    return undefined;
  }
  return code;
}

/** undefined = nicht gesetzt, null = "none" (etwas anderes startet den Server neu), sonst Dateiname. */
function scriptName(name) {
  const value = str(name);
  if (value === '') return undefined;
  if (/^(none|off)$/i.test(value)) return null;
  // Wird in einen PowerShell-Befehl eingesetzt – daher nur einfache Dateinamen zulassen.
  if (!/^[\w .-]+\.(bat|cmd|sh)$/i.test(value)) {
    problems.push(() => t('config.invalidScript', { name, raw: value }));
    return undefined;
  }
  return value;
}

function repoSlug(name, fallback) {
  const value = str(name, fallback);
  if (value && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    problems.push(() => t('config.invalidRepo', { name, raw: value }));
    return fallback;
  }
  return value;
}

function schedule(name) {
  try {
    return parseSchedule(str(name));
  } catch (err) {
    problems.push(() => t('config.invalidSchedule', { name, part: err.part ?? err.message }));
    return [];
  }
}

function timezone(name, fallback) {
  const tz = str(name, fallback);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    problems.push(() => t('config.invalidTimezone', { name, raw: tz }));
    return fallback;
  }
}

// RADMIN_NETWORK / RADMIN_PASSWORD aus v1.2 gelten weiter als VPN_NETWORK / VPN_PASSWORD.
const legacyRadmin = Boolean(str('RADMIN_NETWORK') || str('RADMIN_PASSWORD'));
const envLanguage = language('LANGUAGE');
const envRestartScript = scriptName('RESTART_SCRIPT_NAME');

export const config = {
  discordToken: str('DISCORD_TOKEN'),
  language: envLanguage ?? DEFAULT_LANGUAGE, // endgültig erst nach applyStoredDefaults()
  languageSource: envLanguage ? 'env' : 'default',

  mcHost: str('MC_HOST', '127.0.0.1'),
  mcPort: num('MC_PORT', 25565, { min: 1, max: 65535 }),
  rconPort: num('RCON_PORT', 25575, { min: 1, max: 65535 }),
  rconPassword: str('RCON_PASSWORD'),

  // Anzeige
  serverName: str('SERVER_NAME', 'Minecraft Server'),
  versionText: str('VERSION_TEXT'),
  connectAddress: str('CONNECT_ADDRESS'),
  vpnName: str('VPN_NAME', legacyRadmin ? 'Radmin VPN' : ''),
  vpnNetwork: str('VPN_NETWORK', str('RADMIN_NETWORK')),
  vpnPassword: str('VPN_PASSWORD', str('RADMIN_PASSWORD')),
  infoText: multiline('INFO_TEXT'),
  thumbnailUrl: url('THUMBNAIL_URL'),
  showPlayerList: bool('SHOW_PLAYER_LIST', true),
  maxListedPlayers: num('MAX_LISTED_PLAYERS', 40, { min: 1, max: 100 }),
  showTps: bool('SHOW_TPS', true),
  tpsCommand: choice('TPS_COMMAND', 'auto', TPS_COMMANDS),
  showUptime: bool('SHOW_UPTIME', true),
  showVersion: bool('SHOW_VERSION', true),
  showRecords: bool('SHOW_RECORDS', true),
  showNextRestart: bool('SHOW_NEXT_RESTART', true),
  showMotd: bool('SHOW_MOTD', false),
  showLastUpdated: bool('SHOW_LAST_UPDATED', true),
  showPresence: bool('SHOW_PRESENCE', true),

  // Abfrage
  pollIntervalSec: num('POLL_INTERVAL_SECONDS', 15, { min: 5, max: 300 }),
  heartbeatSec: num('HEARTBEAT_SECONDS', 60, { min: 30, max: 3600 }),
  offlineAfterFails: num('OFFLINE_AFTER_FAILS', 3, { min: 1, max: 20 }),

  // Meldungen (der Channel wird per /mc bot alerts gesetzt)
  alertOffline: bool('ALERT_OFFLINE', true),
  offlineAlertMinutes: num('OFFLINE_ALERT_MINUTES', 10, { min: 0, max: 240 }),
  alertRecords: bool('ALERT_RECORDS', true),
  alertRestarts: bool('ALERT_RESTARTS', true),
  alertBotUpdates: bool('ALERT_BOT_UPDATES', true),
  alertJoinLeave: bool('ALERT_JOIN_LEAVE', false),
  timezone: timezone('TIMEZONE', 'Europe/Berlin'),

  // Rechte
  ownerIds: idList('OWNER_IDS'), // leer = Besitzer der Discord-Application
  adminRoleIds: idList('ADMIN_ROLE_IDS'), // zusätzlich zum Recht "Server verwalten"

  // Neustart per /mc server restart und Zeitplan
  restartEnabled: bool('RESTART_ENABLED', true),
  restartScriptName: envRestartScript === undefined ? DEFAULT_RESTART_SCRIPT : envRestartScript, // null = nicht prüfen
  restartTimeoutMinutes: num('RESTART_TIMEOUT_MINUTES', 10, { min: 3, max: 60 }),
  restartCooldownMinutes: num('RESTART_COOLDOWN_MINUTES', 5, { min: 0, max: 120 }),
  restartKillAfterMinutes: num('RESTART_KILL_AFTER_MINUTES', 5, { min: 0, max: 30 }), // 0 = hängenden Server nie beenden
  restartSchedule: schedule('RESTART_SCHEDULE'), // leer = keine geplanten Neustarts
  restartScheduleCountdown: num('RESTART_SCHEDULE_COUNTDOWN_MINUTES', 5, { min: 0, max: 30 }),

  // Auto-Update von GitHub
  version: pkg.version,
  autoUpdate: bool('AUTO_UPDATE', true),
  updateRepo: repoSlug('UPDATE_REPO', pkg.updateRepo ?? ''),
  updateCheckHours: num('UPDATE_CHECK_HOURS', 6, { min: 1, max: 168 }),
};

/**
 * Standards, die state.json für Installationen von vor v1.3 festhält (Deutsch, alter Skriptname),
 * damit ein Update nichts am gewohnten Verhalten ändert. Werte aus der .env gehen immer vor.
 */
export function applyStoredDefaults(stored) {
  if (!stored) return;
  if (envLanguage === undefined && LANGUAGES[stored.language]) {
    config.language = stored.language;
    config.languageSource = 'previous';
  }
  if (envRestartScript === undefined && stored.restartScriptName) config.restartScriptName = stored.restartScriptName;
}

const isPlaceholder = (value) => /^(HIER_|YOUR_)/i.test(value);

export function validateConfig() {
  const errors = problems.map((problem) => problem());
  const warnings = [];

  if (!config.discordToken || isPlaceholder(config.discordToken)) errors.push(t('config.tokenMissing'));
  if (isPlaceholder(config.rconPassword)) {
    errors.push(t('config.rconPlaceholder'));
  } else if (!config.rconPassword) {
    warnings.push(t('config.rconEmpty'));
  }
  if (!config.restartEnabled && config.restartSchedule.length) warnings.push(t('config.scheduleIgnored'));
  return { errors, warnings };
}
