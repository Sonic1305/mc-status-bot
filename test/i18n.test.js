import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord.js';
import { BASE_COMMAND, buildCommandData, handleCommand } from '../src/commands.js';
import { buildStatusEmbed, presenceFor } from '../src/embed.js';
import { LANGUAGES, setLanguage, t } from '../src/i18n.js';
import { emptySnapshot, parseTps, playerChanges } from '../src/monitor.js';
import { announcementText } from '../src/restart.js';
import { PRE_V13_DEFAULTS, parseState } from '../src/state.js';

const SRC = new URL('../src/', import.meta.url);

// Schlüssel, die im Code zusammengesetzt werden (t(`cmd.help.${key}`) usw.)
const DYNAMIC_KEYS = [
  ...['status', 'restart', 'cancelRestart', 'statusChannel', 'alerts', 'alertsOff', 'resetRecords', 'info', 'update'].map((k) => `cmd.help.${k}`),
  ...['offline', 'records', 'restarts', 'updates', 'joinLeave'].map((k) => `info.alertType.${k}`),
  ...['players', 'tps', 'uptime', 'version', 'records', 'nextRestart', 'motd', 'presence'].map((k) => `info.display.${k}`),
  ...['online', 'degraded', 'offline', 'unknown'].map((k) => `info.status.${k}`),
  ...['info', 'warn', 'error'].map((k) => `log.level.${k}`),
  ...Object.keys(LANGUAGES).map((k) => `language.${k}`),
  ...['viewChannel', 'sendMessages', 'embedLinks', 'readHistory'].map((k) => `perm.${k}`),
  'discord.unknownChannel', 'discord.unknownMessage', 'discord.missingAccess', 'discord.missingPermissions',
  'cmd.denied.owner', 'cmd.denied.admin', 'embed.online.title', 'embed.degraded.title', 'cmd.restart.confirm', 'cmd.restart.confirmAnyway',
  'log.updateDisabled', 'log.updateNoRepo',
];

function keysUsedInSource() {
  const keys = new Set(DYNAMIC_KEYS);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(url);
      else if (entry.name.endsWith('.js')) {
        for (const m of fs.readFileSync(url, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
      }
    }
  };
  walk(SRC);
  return keys;
}

test('Alle Sprachen haben dieselben Schlüssel, und jeder benutzte Schlüssel existiert', () => {
  const en = Object.keys(LANGUAGES.en).sort();
  for (const [code, texts] of Object.entries(LANGUAGES)) {
    assert.deepEqual(Object.keys(texts).sort(), en, `${code} weicht von en ab`);
  }
  const missing = [...keysUsedInSource()].filter((key) => !(key in LANGUAGES.en));
  assert.deepEqual(missing, [], 'im Code benutzt, aber nicht übersetzt');
});

test('Jeder Text lässt sich mit leeren Werten erzeugen (keine Tippfehler in den Funktionen)', () => {
  for (const [code, texts] of Object.entries(LANGUAGES)) {
    for (const [key, value] of Object.entries(texts)) {
      if (typeof value === 'function') assert.equal(typeof value({}), 'string', `${code}: ${key}`);
    }
  }
});

test('Englisch ist Standard; unbekannter Schlüssel liefert den Schlüssel', () => {
  setLanguage('en');
  assert.equal(announcementText(60), 'Server restart in 1 minute!');
  assert.equal(announcementText(300), 'Server restart in 5 minutes!');
  assert.equal(t('does.not.exist'), 'does.not.exist');
  assert.throws(() => setLanguage('xx'));
});

test('Status-Nachricht auf Englisch, Anzeige-Schalter', () => {
  setLanguage('en');
  const snapshot = { ...emptySnapshot('online'), online: 2, max: 10, players: [{ name: 'Bob' }, { name: 'alice' }], tps: 20, mspt: 5, motd: 'Hello\nWorld' };
  const state = { onlineSince: Date.now() - 60_000, peakToday: { count: 2 }, record: { count: 5, at: Date.now() } };
  const config = { serverName: 'Test', heartbeatSec: 60, pollIntervalSec: 15, vpnNetwork: 'net', infoText: 'Modpack: example', showMotd: true };

  const full = buildStatusEmbed({ snapshot, state, config }).toJSON();
  assert.equal(full.title, '🟢 Test is online');
  assert.match(full.description, /^> Hello\n> World/);
  assert.match(full.description, /Players: 2 \/ 10\*\*\n• alice\n• Bob/);
  assert.deepEqual(full.fields.map((f) => f.name), ['⚡ Performance', '⏱️ Online since', '📈 Records', '🔗 Connect', 'ℹ️ Info', '🔄 Updated']);

  const minimal = buildStatusEmbed({
    snapshot,
    state,
    config: { ...config, showPlayerList: false, showTps: false, showUptime: false, showRecords: false, showLastUpdated: false, showMotd: false, infoText: '' },
  }).toJSON();
  assert.equal(minimal.description, '**👥 Players: 2 / 10**');
  assert.deepEqual(minimal.fields.map((f) => f.name), ['🔗 Connect']);

  const limited = buildStatusEmbed({ snapshot: { ...snapshot, online: 5 }, state, config: { ...config, maxListedPlayers: 1 } }).toJSON();
  assert.match(limited.description, /• alice\n_… and 4 more_/);
  assert.equal(presenceFor(snapshot).text, '🟢 2/10 players online');
});

test('TPS-Formate: NeoForge, Forge, Paper, Vanilla', () => {
  assert.deepEqual(parseTps('Overall: 19.874 TPS (50.317 ms/tick)', 'neoforge'), { tps: 19.874, mspt: 50.317 });
  assert.deepEqual(parseTps('Dim 0: Mean tick time: 1.0 ms. Mean TPS: 20.000\nOverall: Mean tick time: 0.845 ms. Mean TPS: 20.000', 'forge'), { tps: 20, mspt: 0.845 });
  assert.deepEqual(parseTps('§6TPS from last 1m, 5m, 15m: §a*20.0, §a19.95, §a19.9', 'paper'), { tps: 20, mspt: null });
  assert.deepEqual(parseTps('TPS from last 1m, 5m, 15m: 17,5, 18,0, 19,0', 'paper'), { tps: 17.5, mspt: null });
  assert.deepEqual(parseTps('The game is running normallyTarget tick rate: 20.0 per second.\nAverage time per tick: 2.5ms (Target: 50.0ms)', 'vanilla'), { tps: 20, mspt: 2.5 });
  assert.deepEqual(parseTps('Target tick rate: 20.0 per second.\nAverage time per tick: 80.0ms (Target: 50.0ms)', 'vanilla'), { tps: 12.5, mspt: 80 });
  // Ohne Typ werden alle Formate probiert
  assert.deepEqual(parseTps('Overall: Mean tick time: 0.845 ms. Mean TPS: 20.000'), { tps: 20, mspt: 0.845 });
  assert.equal(parseTps('Unknown or incomplete command, see below for error', 'vanilla'), null);
});

test('Beitreten/Verlassen nur bei vollständigen Namenslisten', () => {
  const snap = (names, extra = {}) => ({ ...emptySnapshot('online'), online: names.length, players: names.map((name) => ({ name })), ...extra });
  assert.deepEqual(playerChanges(snap(['A', 'B']), snap(['B', 'C'])), { joined: ['C'], left: ['A'] });
  assert.equal(playerChanges(snap(['A']), snap(['A'])), null);
  assert.equal(playerChanges(snap(['A']), snap([], { stale: true })), null, 'Aussetzer zählt nicht als Verlassen');
  assert.equal(playerChanges(snap(['A']), snap(['A', 'B'], { namesComplete: false })), null);
  assert.equal(playerChanges(emptySnapshot('unknown'), snap(['A'])), null, 'nach dem Bot-Start keine Beitritts-Flut');
  assert.equal(playerChanges(snap(['A']), { ...emptySnapshot('degraded'), players: [] }), null);
});

test('state.json von v1.2 behält Deutsch und den alten Skriptnamen, neue Installationen nicht', () => {
  const old = parseState(JSON.stringify({ statusChannelId: '1', record: { count: 7, at: 1 } }));
  assert.deepEqual(old.storedDefaults, PRE_V13_DEFAULTS);
  assert.equal(old.stateVersion, 2);
  assert.equal(old.record.count, 7);

  const migratedAgain = parseState(JSON.stringify(old));
  assert.deepEqual(migratedAgain.storedDefaults, PRE_V13_DEFAULTS, 'bleibt nach dem Speichern erhalten');

  const fresh = parseState(JSON.stringify({ stateVersion: 2, storedDefaults: null }));
  assert.equal(fresh.storedDefaults, null);
});

test('Befehle: Namen immer englisch, Beschreibungen in beiden Sprachen innerhalb der Discord-Grenzen', () => {
  const names = (data) => data[0].options.map((o) => [o.name, o.options?.map((s) => s.name)]);
  const perLanguage = {};
  for (const code of Object.keys(LANGUAGES)) {
    setLanguage(code);
    const data = buildCommandData();
    perLanguage[code] = names(data);
    const walk = (opts) => opts.forEach((o) => {
      assert.ok(o.description.length >= 1 && o.description.length <= 100, `${code} ${o.name}: ${o.description.length} Zeichen`);
      o.choices?.forEach((c) => assert.ok(c.name.length <= 100));
      if (o.options) walk(o.options);
    });
    assert.ok(data[0].description.length <= 100);
    walk(data[0].options);
    assert.equal(data[0].options.find((o) => o.name === 'server').options[0].options[0].type, ApplicationCommandOptionType.Integer);
  }
  assert.deepEqual(perLanguage.de, perLanguage.en);
  setLanguage('en');
});

function interaction({ group = null, sub, roles = [], userId = '222222222222222222' }) {
  const calls = { reply: [], edit: [] };
  return {
    calls,
    commandName: BASE_COMMAND,
    user: { id: userId, tag: 'tester#0001', username: 'tester' },
    member: { displayName: 'Tester', roles },
    memberPermissions: { has: () => false },
    options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
    guild: { members: { me: {} } },
    reply: async (msg) => { calls.reply.push(msg); },
    deferReply: async () => {},
    editReply: async (msg) => { calls.edit.push(msg); },
  };
}

test('ADMIN_ROLE_IDS geben Admin-Rechte; RESTART_ENABLED=false blendet Server-Befehle in der Hilfe aus', async () => {
  setLanguage('en');
  const ADMIN_ROLE = '333333333333333333';
  const ctx = {
    config: { serverName: 'X', adminRoleIds: [ADMIN_ROLE], restartEnabled: false },
    state: { alertChannelId: '5', alertRoleId: null },
    save: () => {},
    isOwner: () => false,
    ownerIds: () => [],
  };
  const denied = interaction({ group: 'bot', sub: 'alerts-off', roles: ['444444444444444444'] });
  await handleCommand(denied, ctx);
  assert.match(denied.calls.reply[0].content, /Manage Server/);

  const allowed = interaction({ group: 'bot', sub: 'alerts-off', roles: [ADMIN_ROLE] });
  await handleCommand(allowed, ctx);
  assert.equal(allowed.calls.edit[0], '🔕 Alerts are off.');
  assert.equal(ctx.state.alertChannelId, null);

  const ownerHelp = interaction({ sub: 'help' });
  await handleCommand(ownerHelp, { ...ctx, isOwner: () => true });
  assert.match(ownerHelp.calls.reply[0].content, /\/mc bot update/);
  assert.doesNotMatch(ownerHelp.calls.reply[0].content, /\/mc server/);
  assert.ok(PermissionFlagsBits.ManageGuild);
});
