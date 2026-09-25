import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord.js';
import { BASE_COMMAND, commandData, handleCommand } from '../src/commands.js';
import { emptySnapshot } from '../src/monitor.js';

const OWNER = '111111111111111111';

test('Ein Basisbefehl /mc mit server- und bot-Gruppe, für alle sichtbar', () => {
  assert.equal(commandData.length, 1);
  const [mc] = commandData;
  assert.equal(mc.name, BASE_COMMAND);
  assert.equal(mc.default_member_permissions ?? null, null, 'sichtbar für alle (wegen /mc status)');

  const tree = Object.fromEntries(mc.options.map((o) => [o.name,
    o.type === ApplicationCommandOptionType.SubcommandGroup ? o.options.map((s) => s.name) : 'sub']));
  assert.deepEqual(tree, {
    status: 'sub',
    help: 'sub',
    server: ['restart', 'cancel-restart'],
    bot: ['status-channel', 'alerts', 'alerts-off', 'reset-records', 'info', 'update'],
  });

  // Discord-Grenzen: Namen klein, max. 32 Zeichen; Beschreibungen max. 100 Zeichen
  const walk = (opts) => opts.forEach((o) => {
    assert.match(o.name, /^[-_\p{Ll}\p{N}]{1,32}$/u, o.name);
    assert.ok(o.description.length <= 100, `${o.name}: Beschreibung zu lang`);
    if (o.options) walk(o.options);
  });
  walk(mc.options);
});

function interaction({ group = null, sub, userId = '222222222222222222', admin = false, options = {} }) {
  const calls = { reply: [], edit: [], deferred: false };
  return {
    calls,
    commandName: BASE_COMMAND,
    user: { id: userId, tag: 'tester#0001', username: 'tester' },
    member: { displayName: 'Tester' },
    memberPermissions: { has: (flag) => admin && flag === PermissionFlagsBits.ManageGuild },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getInteger: (name) => options[name] ?? null,
      getChannel: (name) => options[name],
      getRole: (name) => options[name] ?? null,
    },
    guild: { members: { me: {} } },
    reply: async (msg) => { calls.reply.push(msg); },
    deferReply: async () => { calls.deferred = true; },
    editReply: async (msg) => { calls.edit.push(msg); return {}; },
  };
}

function ctx(extra = {}) {
  const state = { alertChannelId: '5', alertRoleId: '6', peakToday: { count: 0 }, record: { count: 0 } };
  return {
    config: { serverName: 'TNP', version: '9.9.9', restartSchedule: [], restartScheduleCountdown: 5, restartKillAfterMinutes: 5 },
    state,
    save: () => {},
    isOwner: (id) => id === OWNER,
    ownerIds: () => [OWNER],
    getSnapshot: () => emptySnapshot('online'),
    getNextRestart: () => null,
    restart: { cancel: () => 'Es ist kein Neustart geplant.' },
    ...extra,
  };
}

const text = (msg) => (typeof msg === 'string' ? msg : msg.content);

test('Rechte: Admin-Befehl ohne "Server verwalten" wird abgelehnt', async () => {
  const i = interaction({ group: 'bot', sub: 'alerts-off' });
  const c = ctx();
  await handleCommand(i, c);
  assert.match(text(i.calls.reply[0]), /Server verwalten/);
  assert.equal(c.state.alertChannelId, '5', 'nichts geändert');
});

test('Rechte: Admin darf Admin-Befehle, aber keine Besitzer-Befehle', async () => {
  const c = ctx();
  const allowed = interaction({ group: 'bot', sub: 'alerts-off', admin: true });
  await handleCommand(allowed, c);
  assert.ok(allowed.calls.deferred);
  assert.match(text(allowed.calls.edit[0]), /Meldungen sind aus/);
  assert.equal(c.state.alertChannelId, null);

  for (const [group, sub] of [['server', 'restart'], ['server', 'cancel-restart'], ['bot', 'update']]) {
    const denied = interaction({ group, sub, admin: true });
    await handleCommand(denied, ctx());
    assert.match(text(denied.calls.reply[0]), /nur der Bot-Besitzer/, `${group} ${sub}`);
  }
});

test('Rechte: Bot-Besitzer darf alles, auch ohne Discord-Adminrechte', async () => {
  const c = ctx();
  const i = interaction({ group: 'bot', sub: 'alerts-off', userId: OWNER });
  await handleCommand(i, c);
  assert.equal(c.state.alertChannelId, null);

  const cancel = interaction({ group: 'server', sub: 'cancel-restart', userId: OWNER });
  await handleCommand(cancel, ctx());
  assert.match(text(cancel.calls.reply[0]), /kein Neustart geplant/);
});

test('/mc status und /mc help für alle; Hilfe zeigt nur erlaubte Befehle', async () => {
  const status = interaction({ sub: 'status' });
  await handleCommand(status, ctx());
  assert.equal(status.calls.reply[0].embeds.length, 1);

  const helpUser = interaction({ sub: 'help' });
  await handleCommand(helpUser, ctx());
  assert.match(text(helpUser.calls.reply[0]), /\/mc status/);
  assert.doesNotMatch(text(helpUser.calls.reply[0]), /\/mc bot|\/mc server/);

  const helpAdmin = interaction({ sub: 'help', admin: true });
  await handleCommand(helpAdmin, ctx());
  assert.match(text(helpAdmin.calls.reply[0]), /\/mc bot info/);
  assert.doesNotMatch(text(helpAdmin.calls.reply[0]), /\/mc bot update|\/mc server restart/);

  const helpOwner = interaction({ sub: 'help', userId: OWNER });
  await handleCommand(helpOwner, ctx());
  assert.match(text(helpOwner.calls.reply[0]), /\/mc bot update/);
  assert.match(text(helpOwner.calls.reply[0]), /\/mc server restart/);
});

test('Alte Befehle werden ignoriert', async () => {
  const old = { ...interaction({ sub: 'setup' }), commandName: 'statusbot' };
  await handleCommand(old, ctx());
  assert.equal(old.calls.reply.length + old.calls.edit.length, 0);
});
