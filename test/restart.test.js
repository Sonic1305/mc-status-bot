import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { announcementSchedule, announcementText, RestartManager } from '../src/restart.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ status = 'online', rconEnabled = true, processes = { getListeningProcess: async () => null, isProcessAlive: async () => null, killProcess: async () => false }, killAfter = 5 } = {}) {
  const commands = [];
  const alerts = [];
  const state = { restart: null, lastRestartAt: null, offlineAlert: null };
  const monitor = {
    snapshot: { status, stale: false },
    rconEnabled,
    rconExec: async (cmd) => { commands.push(cmd); return ''; },
    rconPauses: [],
    pauseRcon(p) { this.rconPauses.push(p); },
  };
  const manager = new RestartManager({
    config: { serverName: 'TNP', restartTimeoutMinutes: 10, restartCooldownMinutes: 5, restartScriptName: 'start-mit-neustart.bat', restartKillAfterMinutes: killAfter, mcPort: 25565, mcHost: '127.0.0.1' },
    state,
    save: () => {},
    monitor,
    notify: (alert) => alerts.push(alert),
    refresh: async () => {},
    processes,
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
    await manager.onPoll(monitor.snapshot, Date.now() + 60_000);
    assert.equal(state.restart.sawDown, true);
    // ... und ist wieder da.
    await manager.onPoll({ status: 'online' }, Date.now() + 200_000);
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

test('Server kommt nicht zurück: Warnung mit Ping nach Timeout', async () => {
  const { manager, state, alerts } = setup();
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'Son', stopSentAt: t0, sawDown: false };
  await manager.onPoll({ status: 'offline' }, t0 + 60_000);
  assert.ok(state.restart);
  await manager.onPoll({ status: 'offline' }, t0 + 10 * 60_000);
  assert.equal(state.restart, null);
  assert.equal(state.offlineAlert, 'sent');
  assert.equal(alerts.at(-1).ping, true);
  assert.match(alerts.at(-1).text, /noch nicht wieder da/);
});

test('Server beendet sich nicht: Neustart gilt nach 3 Min. als fehlgeschlagen', async () => {
  const { manager, state, alerts } = setup();
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'Son', stopSentAt: t0, sawDown: false };
  await manager.onPoll({ status: 'online' }, t0 + 60_000);
  assert.ok(state.restart, 'noch am Herunterfahren');
  await manager.onPoll({ status: 'online', stale: true }, t0 + 90_000);
  assert.equal(state.restart.sawDown, true, 'fehlgeschlagene Abfrage zählt als "war weg"');

  const other = setup();
  other.state.restart = { phase: 'restarting', byName: 'Son', stopSentAt: t0, sawDown: false };
  await other.manager.onPoll({ status: 'online' }, t0 + 3 * 60_000);
  assert.equal(other.state.restart, null);
  assert.match(other.alerts.at(-1).text, /fehlgeschlagen/);
});

test('Kein Neustart ohne RCON, bei eingeschränktem Server oder doppelt', () => {
  assert.match(setup({ rconEnabled: false }).manager.checkAllowed(), /Ohne RCON/);
  assert.match(setup({ status: 'degraded' }).manager.checkAllowed(), /nicht \(voll\) erreichbar/);
  assert.match(setup({ status: 'offline' }).manager.checkAllowed(), /nicht \(voll\) erreichbar/);
  const { manager } = setup();
  assert.equal(manager.start({ minutes: 31, userId: '1', userName: 'x' }), 'Ungültiger Countdown.');
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

// --- Hänger-Absicherung (Serverprozess beendet sich nach "stop" nicht) ---

const PROC = { pid: 4242, startedAt: 1_000 };

function fakeProcesses({ aliveSeq = [], killResult = true } = {}) {
  const calls = { list: 0, alive: 0, kill: [] };
  return {
    calls,
    processes: {
      getListeningProcess: async () => { calls.list += 1; return PROC; },
      isProcessAlive: async (p) => { assert.deepEqual(p, PROC); calls.alive += 1; return aliveSeq.length ? aliveSeq.shift() : false; },
      killProcess: async (p) => { calls.kill.push(p.pid); return killResult; },
    },
  };
}

test('stop: Serverprozess wird vorher gemerkt, RCON ruht bis der Neustart fertig ist', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const fake = fakeProcesses({ aliveSeq: [false] });
    const { manager, state, monitor, commands } = setup({ processes: fake.processes });
    manager.start({ minutes: 0, userId: '1', userName: 'Son' });
    mock.timers.tick(5_000);
    await flush();
    assert.ok(commands.includes('stop'));
    assert.equal(fake.calls.list, 1);
    assert.deepEqual(state.restart.serverProcess, PROC);
    assert.deepEqual(monitor.rconPauses, [true]);

    await manager.onPoll({ status: 'offline' }, Date.now() + 30_000);   // Prozess ist weg
    assert.equal(state.restart.processGone, true);
    await manager.onPoll({ status: 'online' }, Date.now() + 180_000);   // neuer Server antwortet
    assert.equal(state.restart, null);
    assert.deepEqual(monitor.rconPauses, [true, false]);
    assert.equal(fake.calls.kill.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('Zombie: alter Prozess antwortet noch auf Pings -> gilt nicht als "wieder da"', async () => {
  const fake = fakeProcesses({ aliveSeq: [true, true] });
  const { manager, state } = setup({ processes: fake.processes });
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'x', stopSentAt: t0, sawDown: false, serverProcess: PROC };
  await manager.onPoll({ status: 'online' }, t0 + 60_000);
  await manager.onPoll({ status: 'degraded' }, t0 + 120_000);
  assert.equal(state.restart?.phase, 'restarting', 'Neustart läuft weiter, obwohl der Ping antwortet');
  assert.equal(fake.calls.kill.length, 0, 'vor Ablauf der Frist wird nichts beendet');
});

test('Hänger: nach 5 Min. wird genau der gemerkte Prozess beendet, danach normaler Neustart', async () => {
  const fake = fakeProcesses({ aliveSeq: [true, true] });
  const { manager, state, alerts, monitor } = setup({ processes: fake.processes });
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'x', stopSentAt: t0, sawDown: false, serverProcess: PROC };
  await manager.onPoll({ status: 'online' }, t0 + 4 * 60_000);
  assert.equal(fake.calls.kill.length, 0);
  await manager.onPoll({ status: 'online' }, t0 + 5 * 60_000);
  assert.deepEqual(fake.calls.kill, [4242]);
  assert.equal(state.restart.processGone, true);
  assert.match(alerts.at(-1).text, /hing nach dem Stoppen/);
  assert.ok(!alerts.at(-1).ping, 'kein Ping – es wird ja automatisch behoben');

  await manager.onPoll({ status: 'offline' }, t0 + 6 * 60_000);
  // Timeout zählt ab dem Beenden: 9 Min. nach stop ist noch kein Alarm fällig
  await manager.onPoll({ status: 'offline' }, t0 + 14 * 60_000);
  assert.equal(state.restart?.phase, 'restarting');
  await manager.onPoll({ status: 'online' }, t0 + 16 * 60_000);
  assert.equal(state.restart, null);
  assert.deepEqual(monitor.rconPauses, [false]);
});

test('Hänger: Beenden scheitert -> Warnung mit Ping, RCON wieder frei', async () => {
  const fake = fakeProcesses({ aliveSeq: [true], killResult: false });
  const { manager, state, alerts, monitor } = setup({ processes: fake.processes });
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'x', stopSentAt: t0, sawDown: false, serverProcess: PROC };
  await manager.onPoll({ status: 'online' }, t0 + 5 * 60_000);
  assert.equal(state.restart, null);
  assert.equal(alerts.at(-1).ping, true);
  assert.match(alerts.at(-1).text, /konnte nicht beendet werden/);
  assert.deepEqual(monitor.rconPauses, [false]);
});

test('Absicherung aus (0): hängender Server gilt nach 3 Min. als fehlgeschlagen, nichts wird beendet', async () => {
  const fake = fakeProcesses({ aliveSeq: [true] });
  const { manager, state, alerts } = setup({ processes: fake.processes, killAfter: 0 });
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'x', stopSentAt: t0, sawDown: false, serverProcess: PROC };
  await manager.onPoll({ status: 'online' }, t0 + 3 * 60_000);
  assert.equal(state.restart, null);
  assert.equal(fake.calls.kill.length, 0);
  assert.match(alerts.at(-1).text, /fehlgeschlagen/);
});

test('Prozess nicht prüfbar -> bisheriges Verhalten über den Ping', async () => {
  const fake = fakeProcesses({ aliveSeq: [null, null] });
  const { manager, state } = setup({ processes: fake.processes });
  const t0 = 1_000_000;
  state.restart = { phase: 'restarting', byName: 'x', stopSentAt: t0, sawDown: false, serverProcess: PROC };
  await manager.onPoll({ status: 'offline' }, t0 + 60_000);
  await manager.onPoll({ status: 'online' }, t0 + 200_000);
  assert.equal(state.restart, null);
});

test('Bot-Neustart mitten im Neustart: RCON bleibt pausiert', () => {
  const { manager, state, monitor } = setup();
  state.restart = { phase: 'restarting', stopSentAt: 0, serverProcess: PROC };
  manager.recoverAfterBotStart();
  assert.deepEqual(monitor.rconPauses, [true]);
});