import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import { correctedOnlineSince, getListeningProcess, getListeningProcessStart, isLocalHost, isProcessAlive, killProcess } from '../src/uptime.js';

const H = 60 * 60 * 1000;
const now = Date.parse('2026-09-25T12:00:00Z');

test('"Online seit" korrigieren', () => {
  // Server nach Absturz neu gestartet, während der Bot aus war: alte Zeit 7 h, Prozess seit 20 Min.
  assert.equal(correctedOnlineSince(now - 7 * H, now - H / 3), now - H / 3);
  // Bot hat den Wechsel selbst gesehen: Prozess startete 3 Min. vor der Beobachtung (Mods laden) -> Beobachtung bleibt
  assert.equal(correctedOnlineSince(now - H, now - H - 3 * 60_000), null);
  // Bot neu installiert, Server läuft schon 2 Tage -> Prozess-Startzeit übernehmen
  assert.equal(correctedOnlineSince(now, now - 48 * H), now - 48 * H);
  // Noch keine Zeit bekannt
  assert.equal(correctedOnlineSince(null, now - H), now - H);
  // Keine Prozess-Info -> nichts ändern
  assert.equal(correctedOnlineSince(now - H, null), null);
});

test('Nur lokale Adressen', () => {
  assert.ok(isLocalHost('127.0.0.1'));
  assert.ok(isLocalHost('localhost'));
  assert.equal(isLocalHost('203.0.113.9'), false);
});

test('Startzeit des Prozesses auf einem lauschenden Port (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = await getListeningProcessStart(server.address().port);
    const expected = Date.now() - process.uptime() * 1000; // dieser Node-Prozess lauscht selbst
    assert.ok(started, 'Startzeit gefunden');
    assert.ok(Math.abs(started - expected) < 5000, `Abweichung ${started - expected} ms`);
  } finally {
    server.close();
  }
  assert.equal(await getListeningProcessStart(1), null, 'niemand lauscht auf Port 1');
  assert.equal(await getListeningProcessStart(25565, { host: '203.0.113.9' }), null, 'fremder Host');
});

test('Serverprozess finden, pruefen und hart beenden (Windows, echter Kindprozess)', { skip: process.platform !== 'win32' }, async () => {
  // Kindprozess spielt den Minecraft-Server: lauscht auf einem freien Port und beendet sich nie selbst.
  const script = "const s = require('net').createServer().listen(0, '127.0.0.1', () => console.log(s.address().port)); setInterval(() => {}, 1000);";
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    const port = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(Number(String(d).trim()))));
    const proc = await getListeningProcess(port);
    assert.equal(proc.pid, child.pid, 'richtiger Prozess gefunden');
    assert.equal(await isProcessAlive(proc), true);
    assert.equal(await isProcessAlive({ ...proc, startedAt: proc.startedAt - 60_000 }), false, 'andere Startzeit = anderer Prozess');
    assert.equal(await killProcess(proc), true);
    await exited;
    assert.equal(await isProcessAlive(proc), false, 'nach dem Beenden weg');
  } finally {
    child.kill();
  }
});