import assert from 'node:assert/strict';
import test from 'node:test';
import { pingServer } from '../src/ping.js';
import { RconClient } from '../src/rcon.js';
import { startMockRcon, startMockStatus } from './mock-servers.js';

const LIST = 'There are 1 of a max of 16 players online: Steve (069a79f4-44e9-4726-a5be-fca90e38aaf5)';

test('RCON: Anmeldung, mehrere Befehle, lange Antwort über mehrere Pakete', async () => {
  const big = 'x'.repeat(10_000);
  const mock = await startMockRcon({ password: 'geheim', commands: { 'list uuids': LIST, big } });
  const rcon = new RconClient({ host: '127.0.0.1', port: mock.port, password: 'geheim', timeoutMs: 2000 });
  try {
    assert.equal(await rcon.exec('list uuids'), LIST);
    assert.equal(await rcon.exec('big'), big);
    // Parallel aufgerufen: dürfen nicht gleichzeitig beim Server ankommen.
    const results = await Promise.all([rcon.exec('list uuids'), rcon.exec('big'), rcon.exec('list uuids')]);
    assert.deepEqual(results, [LIST, big, LIST]);
    assert.equal(mock.stats.connections, 1, 'Verbindung wird wiederverwendet');
    assert.equal(mock.stats.droppedForCoalescing, 0);
  } finally {
    rcon.close();
    mock.server.close();
  }
});

test('RCON: falsches Passwort gibt verständlichen Fehler', async () => {
  const mock = await startMockRcon({ password: 'richtig', commands: {} });
  const rcon = new RconClient({ host: '127.0.0.1', port: mock.port, password: 'falsch', timeoutMs: 2000 });
  try {
    await assert.rejects(rcon.exec('list uuids'), /Passwort ist falsch/);
  } finally {
    rcon.close();
    mock.server.close();
  }
});

test('RCON: Server nicht erreichbar', async () => {
  const rcon = new RconClient({ host: '127.0.0.1', port: 1, password: 'x', timeoutMs: 2000 });
  await assert.rejects(rcon.exec('list'), /Keine Verbindung/);
});

test('RCON: verbindet nach getrennter Verbindung automatisch neu', async () => {
  const mock = await startMockRcon({ password: 'pw', commands: { 'list uuids': LIST } });
  const rcon = new RconClient({ host: '127.0.0.1', port: mock.port, password: 'pw', timeoutMs: 2000 });
  try {
    assert.equal(await rcon.exec('list uuids'), LIST);
    for (const socket of mock.stats.sockets) socket.destroy(); // Server trennt (z. B. Neustart)
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await rcon.exec('list uuids'), LIST);
    assert.equal(mock.stats.connections, 2);
  } finally {
    rcon.close();
    mock.server.close();
  }
});

test('RCON: Timeout, wenn der Server hängt', async () => {
  const mock = await startMockRcon({ password: 'pw', commands: {} });
  // Server, der nach der Anmeldung nicht mehr antwortet
  const rcon = new RconClient({ host: '127.0.0.1', port: mock.port, password: 'pw', timeoutMs: 300 });
  try {
    await rcon.exec('irgendwas'); // anmelden
    for (const socket of mock.stats.sockets) socket.removeAllListeners('data');
    await assert.rejects(rcon.exec('list uuids'), /Timeout/);
  } finally {
    rcon.close();
    mock.server.close();
  }
});

test('Status-Ping: liest Spielerzahl, Stichprobe, Version und MOTD', async () => {
  const mock = await startMockStatus({
    version: { name: '1.21.1', protocol: 767 },
    players: {
      online: 3,
      max: 16,
      sample: [
        { name: 'Steve', id: '069a79f4-44e9-4726-a5be-fca90e38aaf5' },
        { name: 'Anonymous Player', id: '00000000-0000-0000-0000-000000000000' },
      ],
    },
    description: { text: '§fT§6N§fP', extra: [{ text: ' Server' }] },
  });
  try {
    const result = await pingServer('127.0.0.1', mock.port, { timeoutMs: 2000 });
    assert.equal(result.online, 3);
    assert.equal(result.max, 16);
    assert.deepEqual(result.sample, [{ name: 'Steve', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5' }]);
    assert.equal(result.version, '1.21.1');
    assert.equal(result.motd, 'TNP Server');
  } finally {
    mock.server.close();
  }
});

test('Status-Ping: Server aus', async () => {
  await assert.rejects(pingServer('127.0.0.1', 1, { timeoutMs: 2000 }), /Status-Ping/);
});
