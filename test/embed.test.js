import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatusEmbed, buildStoppedEmbed, presenceFor, statusSignature } from '../src/embed.js';
import { emptySnapshot } from '../src/monitor.js';

const config = {
  serverName: 'TNP Limitless 8',
  versionText: 'TNP Limitless 8 v1.73.0',
  radminNetwork: 'TNP8',
  radminPassword: '',
  connectAddress: '26.1.2.3:25565',
  showTps: true,
  heartbeatSec: 60,
  pollIntervalSec: 15,
};
const state = {
  onlineSince: Date.now() - 3_600_000,
  offlineSince: null,
  peakToday: { date: '2026-09-24', count: 3 },
  record: { count: 9, at: Date.now() - 86_400_000 },
};
const online = {
  ...emptySnapshot('online'),
  online: 3,
  max: 16,
  players: [{ name: 'steve_x' }, { name: 'Alex' }, { name: 'Notch' }],
  tps: 19.8,
  mspt: 23.4,
  checkedAt: Date.now(),
};

test('Embed online: Spielerliste sortiert, Namen escaped, alle Felder da', () => {
  const json = buildStatusEmbed({ snapshot: online, state, config }).toJSON();
  assert.match(json.title, /🟢 TNP Limitless 8 ist online/);
  assert.match(json.description, /Spieler: 3 \/ 16/);
  assert.match(json.description, /• Alex\n• Notch\n• steve\\_x/);
  const names = json.fields.map((f) => f.name);
  assert.deepEqual(names, ['⚡ Leistung', '⏱️ Online seit', '📦 Version', '📈 Rekorde', '🔗 Verbinden (Radmin VPN)', '🔄 Aktualisiert']);
  assert.match(json.fields[0].value, /19\.8.*TPS · 23 ms/);
  assert.match(json.fields[4].value, /26\.1\.2\.3:25565/);
});

test('Embed eingeschränkt, offline, unbekannt, beendet', () => {
  const degraded = buildStatusEmbed({ snapshot: { ...online, status: 'degraded', tps: null }, state, config }).toJSON();
  assert.match(degraded.title, /🟡/);
  assert.match(degraded.description, /RCON antwortet gerade nicht/);

  const offline = buildStatusEmbed({ snapshot: emptySnapshot('offline'), state: { ...state, offlineSince: Date.now() }, config }).toJSON();
  assert.match(offline.title, /🔴 .* offline/);

  assert.match(buildStatusEmbed({ snapshot: emptySnapshot('unknown'), state, config }).toJSON().title, /⏳/);
  assert.match(buildStoppedEmbed({ config }).toJSON().title, /⚫/);
});

test('Niemand online / mehr Spieler als Namen bekannt', () => {
  const empty = buildStatusEmbed({ snapshot: { ...online, online: 0, players: [] }, state, config }).toJSON();
  assert.match(empty.description, /niemand online/);
  const partial = buildStatusEmbed({ snapshot: { ...online, status: 'degraded', online: 15, namesComplete: false }, state, config }).toJSON();
  assert.match(partial.description, /und 12 weitere/);
});

test('Signatur ändert sich bei Join, nicht bei kleinen TPS-Schwankungen', () => {
  const base = statusSignature(online, state, config);
  assert.equal(statusSignature({ ...online, tps: 19.1, mspt: 40 }, state, config), base);
  assert.notEqual(statusSignature({ ...online, tps: 12 }, state, config), base);
  assert.notEqual(statusSignature({ ...online, online: 4, players: [...online.players, { name: 'Neu' }] }, state, config), base);
});

test('Präsenz', () => {
  assert.equal(presenceFor(online).text, '🟢 3/16 Spieler online');
  assert.equal(presenceFor(emptySnapshot('offline')).status, 'dnd');
});
