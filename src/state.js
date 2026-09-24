import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

// Dauerhafter Zustand (überlebt Neustarts): wo die Status-Nachricht steht, Rekorde usw.
const STATE_FILE = fileURLToPath(new URL('../state.json', import.meta.url));

const DEFAULTS = {
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

export function loadState() {
  try {
    const data = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    lastWritten = JSON.stringify(data, null, 2);
    return data;
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn(`state.json konnte nicht gelesen werden (${err.message}) – starte mit leerem Zustand.`);
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
