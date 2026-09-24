import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { announcementSchedule, announcementText, RestartManager } from '../src/restart.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ status = 'online', rconEnabled = true } = {}) {
  const commands = [];
  const alerts = [];
  const state = { restart: null, lastRestartAt: null, offlineAlert: null };
  const monitor = {
    snapshot: { status, stale: false },
    rconEnabled,
    rconExec: async (cmd) => { commands.push(cmd); return ''; },
  };
  const manager = new RestartManager({
    config: { serverName: 'TNP', restartTimeoutMinutes: 10, restartCooldownMinutes: 5, restartScriptName: 'start-mit-neustart.bat' },
    state,
    save: () => {},
    monitor,
    notify: (alert) => alerts.push(alert),
    refresh: async () => {},
  });
  const said = () => commands.filter((c) => c.startsWith('tellraw')).map((c) => JSON.parse(c.slice('tellraw @a '.length)).text);
  return { manager, state, monitor, commands, alerts, said };
}

test('Ansagen: Zeitpunkte und Texte', () => {
  assert.deepEqual(announcementSchedule(0), []);
  assert.deepEqual(announcementSchedule(60), [60, 30, 10, 5, 4, 3, 2, 1]);
  assert.deepEqual(announcementSchedule(300), [300, 120, 60, 30, 10, 5, 4, 3, 2, 1]);
  assert.deepEqual(announcementSchedule(600).slice(0, 3), [600, 300, 120]);
  assert.equal(announcementText(60), 'Server-Neustart in 1 Minute!');
  assert.equal(announcementText(300), 'Server-Neustart in 5 Minuten!');
  assert.equal(announcementText(1), 'Server-Neustart in 1 Sekunde!');
});

test('Neustart mit 1 Minute: Ansagen, stop, Wiederkommen, Sperrzeit', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const { manager, state, monitor, commands, alerts, said } = setup();
    assert.equal(manager.start({ minutes: 1, userId: '1', userName: 'Son' }), null);
    assert.equal(state.restart.phase, 'countdown');
    mock.timers.tick(0);
    assert.deepEqual(said(), ['[Server] Server-Neustart in 1 Minute!']);
    assert.match(alerts[0].text, /Neustart geplant/);

    mock.timers.tick(30_000);
    await flush();
    assert.equal(said().at(-1), '[Server] Server-Neustart in 30 Sekunden!');
    assert.ok(!commands.includes('stop'), 'noch kein stop');

    mock.timers.tick(30_000);
    await flush();
    assert.ok(commands.includes('stop'), 'stop nach 60 s');
    assert.equal(said().length, 8, 'Ansagen bei 60/30/10/5/4/3/2/1 s');
    assert.equal(state.restart.phase, 'restarting');

    // Server fährt herunter ...
    monitor.snapshot = { status: 'offline' };
    manager.onPoll(monitor.snapshot, Date.now() + 60_000);
    assert.equal(state.restart.sawDown, true);
    // ... und ist wieder da.
    manager.onPoll({ status: 'online' }, Date.now() + 200_000);
    assert.equal(state.restart, null);
    assert.match(alerts.at(-1).text, /nach dem Neustart wieder online\*\* \(Dauer 3:20 Min\.\)/);
    assert.ok(!alerts.at(-1).ping);

    // Sperrzeit: direkt danach kein neuer Neustart
    monitor.snapshot = { status: 'online' };
    assert.match(manager.start({ minutes: 0, userId: '1', userName: 'Son' }), /erst kurz her/);
  } finally {
    mock.timers.reset();
  }
});

test('Sofort-Neustart: stop nach 5 Sekunden', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const { manager, commands, said } = setup();
    manager.start({ minutes: 0, userId: '1', userName: 'Son' });
    assert.match(said()[0], /JETZT/);
    mock.timers.tick(4_999);
    await flush();
    assert.ok(!commands.includes('stop'));
    mock.timers.tick(1);
    await flush();
    assert.ok(commands.includes('stop'));
  } finally {
    mock.timers.reset();
  }
});

test('Abbrechen während des Countdowns verhindert stop', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const { manager, state, commands, said } = setup();
    manager.start({ minutes: 5, userId: '1', userName: 'Son' });
    mock.timers.tick(60_000);
    assert.equal(manager.cancel({ userName: 'Son' }), null);
    assert.equal(state.restart, null);
    mock.timers.tick(600_000);
    await flush();
    assert.ok(!commands.includes('stop'));
    assert.equal(said().at(-1), '[Server] Neustart abgebrochen.');
    assert.match(manager.cancel({ userName: 'Son' }), /kein Neustart geplant/);
  } finally {
    mock.timers.reset();
  }
});

test('Server kommt nicht zurück: Warnung mit Ping nach Timeout', () => {
  const { manager, state, alerts } = setup();
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'Son', stopSentAt: t0, sawDown: false };
  manager.onPoll({ status: 'offline' }, t0 + 60_000);
  assert.ok(state.restart);
  manager.onPoll({ status: 'offline' }, t0 + 10 * 60_000);
  assert.equal(state.restart, null);
  assert.equal(state.offlineAlert, 'sent');
  assert.equal(alerts.at(-1).ping, true);
  assert.match(alerts.at(-1).text, /noch nicht wieder da/);
});

test('Server beendet sich nicht: Neustart gilt nach 3 Min. als fehlgeschlagen', () => {
  const { manager, state, alerts } = setup();
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'Son', stopSentAt: t0, sawDown: false };
  manager.onPoll({ status: 'online' }, t0 + 60_000);
  assert.ok(state.restart, 'noch am Herunterfahren');
  manager.onPoll({ status: 'online', stale: true }, t0 + 90_000);
  assert.equal(state.restart.sawDown, true, 'fehlgeschlagene Abfrage zählt als "war weg"');

  const other = setup();
  other.state.restart = { phase: 'restarting', byName: 'Son', stopSentAt: t0, sawDown: false };
  other.manager.onPoll({ status: 'online' }, t0 + 3 * 60_000);
  assert.equal(other.state.restart, null);
  assert.match(other.alerts.at(-1).text, /fehlgeschlagen/);
});

test('Kein Neustart ohne RCON, bei eingeschränktem Server oder doppelt', () => {
  assert.match(setup({ rconEnabled: false }).manager.checkAllowed(), /Ohne RCON/);
  assert.match(setup({ status: 'degraded' }).manager.checkAllowed(), /nicht \(voll\) erreichbar/);
  assert.match(setup({ status: 'offline' }).manager.checkAllowed(), /nicht \(voll\) erreichbar/);
  const { manager } = setup();
  assert.equal(manager.start({ minutes: 7, userId: '1', userName: 'x' }), 'Ungültiger Countdown.');
  manager.start({ minutes: 10, userId: '1', userName: 'x' });
  assert.match(manager.checkAllowed(), /bereits ein Neustart geplant/);
  manager.abortOnShutdown();
});

test('Countdown überlebt keinen Bot-Neustart', () => {
  const { manager, state } = setup();
  state.restart = { phase: 'countdown', stopAt: 0 };
  manager.recoverAfterBotStart();
  assert.equal(state.restart, null);
  state.restart = { phase: 'restarting', stopSentAt: 0 };
  manager.recoverAfterBotStart();
  assert.equal(state.restart.phase, 'restarting', 'laufender Neustart bleibt');
});
