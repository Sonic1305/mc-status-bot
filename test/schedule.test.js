import assert from 'node:assert/strict';
import test from 'node:test';
import { nextSlot, parseSchedule, RestartScheduler, zonedTimeToUtc } from '../src/schedule.js';

const TZ = 'Europe/Berlin';
const iso = (ms) => new Date(ms).toISOString();

test('Zeitplan einlesen', () => {
  assert.deepEqual(parseSchedule(''), []);
  assert.deepEqual(parseSchedule('16:30, 4:00;04:00').map((t) => t.label), ['04:00', '16:30']);
  assert.throws(() => parseSchedule('25:00'), /keine Uhrzeit/);
  assert.throws(() => parseSchedule('4 Uhr'), /keine Uhrzeit/);
});

test('Ortszeit -> UTC, auch über die Zeitumstellung', () => {
  assert.equal(iso(zonedTimeToUtc(2026, 9, 25, 4, 0, TZ)), '2026-09-25T02:00:00.000Z'); // Sommerzeit (UTC+2)
  assert.equal(iso(zonedTimeToUtc(2026, 12, 1, 4, 0, TZ)), '2026-12-01T03:00:00.000Z'); // Winterzeit (UTC+1)
  assert.equal(iso(zonedTimeToUtc(2026, 3, 29, 4, 0, TZ)), '2026-03-29T02:00:00.000Z'); // Tag der Umstellung
  assert.equal(iso(zonedTimeToUtc(2026, 10, 25, 4, 0, TZ)), '2026-10-25T03:00:00.000Z'); // Tag der Rückstellung
});

test('Nächster Termin', () => {
  const schedule = parseSchedule('04:00,16:00');
  // 25.09. 03:00 Uhr Berlin -> heute 04:00
  let slot = nextSlot(schedule, TZ, Date.parse('2026-09-25T01:00:00Z'));
  assert.equal(slot.key, '2026-09-25 04:00');
  assert.equal(iso(slot.at), '2026-09-25T02:00:00.000Z');
  // 25.09. 17:00 Uhr Berlin -> morgen 04:00
  slot = nextSlot(schedule, TZ, Date.parse('2026-09-25T15:00:00Z'));
  assert.equal(slot.key, '2026-09-26 04:00');
  // genau zum Termin -> nächster Termin
  slot = nextSlot(schedule, TZ, Date.parse('2026-09-25T02:00:00Z'));
  assert.equal(slot.key, '2026-09-25 16:00');
  assert.equal(nextSlot([], TZ, Date.now()), null);
});

function setup({ now, onlineSince = Date.parse('2026-09-24T12:00:00Z'), scriptRunning = 1, blocked = null, lastScheduledSlot = null }) {
  let clock = now;
  const started = [];
  const alerts = [];
  const state = { onlineSince, lastScheduledSlot };
  const scheduler = new RestartScheduler({
    config: { restartSchedule: parseSchedule('04:00'), restartScheduleCountdown: 5, timezone: TZ, restartScriptName: 'start-mit-neustart.bat' },
    state,
    save: () => {},
    restartManager: {
      checkAllowed: () => blocked,
      start: (opts) => { started.push(opts); return null; },
    },
    notify: (a) => alerts.push(a),
    countScript: async () => scriptRunning,
    now: () => clock,
  });
  return { scheduler, state, started, alerts, setClock: (ms) => { clock = ms; } };
}

// 04:00 Berlin am 25.09. = 02:00 UTC; Countdown beginnt 03:55 Berlin = 01:55 UTC
const BEFORE = Date.parse('2026-09-25T01:00:00Z');
const COUNTDOWN_START = Date.parse('2026-09-25T01:55:00Z');

test('Löst genau einmal zur Countdown-Zeit aus, leise und mit 5 Min. Vorwarnung', async () => {
  const { scheduler, started, state, setClock } = setup({ now: BEFORE });
  scheduler.start();
  scheduler.stop(); // Intervall nicht nötig, wir rufen tick() selbst
  assert.equal(scheduler.upcoming.key, '2026-09-25 04:00');

  await scheduler.tick();
  assert.equal(started.length, 0, 'zu früh');

  setClock(COUNTDOWN_START);
  await scheduler.tick();
  assert.equal(started.length, 1);
  assert.deepEqual(started[0], { minutes: 5, userId: null, userName: 'Zeitplan (04:00)', quiet: true });
  assert.equal(state.lastScheduledSlot, '2026-09-25 04:00');
  assert.equal(scheduler.upcoming.key, '2026-09-26 04:00', 'weitergeschaltet');

  setClock(COUNTDOWN_START + 20_000);
  await scheduler.tick();
  assert.equal(started.length, 1, 'kein zweites Auslösen');
});

test('Bot startet mitten im Countdown: verkürzter Countdown', async () => {
  const { scheduler, started } = setup({ now: Date.parse('2026-09-25T01:58:00Z') });
  scheduler.start();
  scheduler.stop();
  await scheduler.tick();
  assert.equal(started[0].minutes, 2);
});

test('Schon erledigter Termin wird nach Bot-Neustart nicht wiederholt', async () => {
  const { scheduler, started } = setup({ now: COUNTDOWN_START, lastScheduledSlot: '2026-09-25 04:00' });
  scheduler.start();
  scheduler.stop();
  await scheduler.tick();
  assert.equal(started.length, 0);
});

test('Auslassen: Startskript fehlt (mit Meldung), Server frisch gestartet, Neustart nicht erlaubt, verpasst', async () => {
  let s = setup({ now: BEFORE, scriptRunning: 0 });
  s.scheduler.start(); s.scheduler.stop(); s.setClock(COUNTDOWN_START);
  await s.scheduler.tick();
  assert.equal(s.started.length, 0);
  assert.match(s.alerts[0].text, /ausgelassen.*start-mit-neustart\.bat/s);

  s = setup({ now: BEFORE, onlineSince: COUNTDOWN_START - 10 * 60_000 });
  s.scheduler.start(); s.scheduler.stop(); s.setClock(COUNTDOWN_START);
  await s.scheduler.tick();
  assert.equal(s.started.length, 0);
  assert.equal(s.alerts.length, 0, 'kein Alarm, nur Log');

  s = setup({ now: BEFORE, blocked: 'Der Server startet gerade neu.' });
  s.scheduler.start(); s.scheduler.stop(); s.setClock(COUNTDOWN_START);
  await s.scheduler.tick();
  assert.equal(s.started.length, 0);

  // PC hat geschlafen: erst 10 Min. nach 04:00 wieder aktiv
  s = setup({ now: BEFORE });
  s.scheduler.start(); s.scheduler.stop(); s.setClock(Date.parse('2026-09-25T02:10:00Z'));
  await s.scheduler.tick();
  assert.equal(s.started.length, 0);
  assert.equal(s.scheduler.upcoming.key, '2026-09-26 04:00');
});

test('Ohne Zeitplan passiert nichts', () => {
  const scheduler = new RestartScheduler({ config: { restartSchedule: [], timezone: TZ }, state: {}, save: () => {}, restartManager: {}, notify: () => {} });
  assert.equal(scheduler.enabled, false);
  scheduler.start();
  assert.equal(scheduler.upcoming, null);
});
