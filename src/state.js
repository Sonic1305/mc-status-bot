import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';
import { t } from './i18n.js';

// Dauerhafter Zustand (überlebt Neustarts): wo die Status-Nachricht steht, Rekorde usw.
const STATE_FILE = fileURLToPath(new URL('../state.json', import.meta.url));
const STATE_VERSION = 2;

// Bis v1.2 war der Bot nur deutsch und das Startskript hieß start-mit-neustart.bat.
// Bestehende Installationen behalten das nach dem Update, bis die .env etwas anderes sagt.
export const PRE_V13_DEFAULTS = { language: 'de', restartScriptName: 'start-mit-neustart.bat' };

const DEFAULTS = {
  stateVersion: STATE_VERSION,
  storedDefaults: null, // siehe PRE_V13_DEFAULTS
  statusChannelId: null,
  statusMessageId: null,
  alertChannelId: null,
  alertRoleId: null,
  lastStatus: 'unknown', // 'online' | 'offline' | 'unknown' (Bot war aus)
  onlineSince: null,
  offlineSince: null,
  stoppedAt: null,
  offlineAlert: null, // 'pending' = Ausfall läuft, Meldung noch nicht fällig; 'sent' = gemeldet
  offlinePlayers: null,
  peakToday: { date: null, count: 0 },
  record: { count: 0, at: null },
  restart: null, // laufender Neustart, siehe restart.js
  lastRestartAt: null,
  lastScheduledSlot: null, // zuletzt behandelter geplanter Neustart, z. B. "2026-09-25 04:00"
};

let lastWritten = null;

/** Liest state.json. Ein Zustand ohne stateVersion stammt von v1.2 oder älter. */
export function parseState(json) {
  const stored = JSON.parse(json);
  const data = { ...structuredClone(DEFAULTS), ...stored };
  if (stored.stateVersion === undefined) {
    data.stateVersion = STATE_VERSION;
    data.storedDefaults = { ...PRE_V13_DEFAULTS };
  }
  return data;
}

export function loadState() {
  let json;
  try {
    json = fs.readFileSync(STATE_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn(t('log.stateUnreadable', { error: err.message }));
    return structuredClone(DEFAULTS);
  }
  try {
    const data = parseState(json);
    lastWritten = json; // Eine Umstellung auf das neue Format wird beim nächsten save() geschrieben.
    return data;
  } catch (err) {
    log.warn(t('log.stateUnreadable', { error: err.message }));
    return structuredClone(DEFAULTS);
  }
}

export function saveState(state) {
  const json = JSON.stringify(state, null, 2);
  if (json === lastWritten) return;
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, STATE_FILE);
  lastWritten = json;
}
