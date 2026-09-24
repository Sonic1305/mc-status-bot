import assert from 'node:assert/strict';
import test from 'node:test';
import { parseList, parseTps } from '../src/monitor.js';

test('parseList: niemand online', () => {
  assert.deepEqual(parseList('There are 0 of a max of 16 players online: '), { online: 0, max: 16, players: [] });
});

test('parseList: Namen mit UUIDs', () => {
  const result = parseList(
    'There are 2 of a max of 16 players online: Steve_01 (069a79f4-44e9-4726-a5be-fca90e38aaf5), Alex (853c80ef-3c37-49fd-aa49-938b674adae6)',
  );
  assert.equal(result.online, 2);
  assert.equal(result.max, 16);
  assert.deepEqual(result.players, [
    { name: 'Steve_01', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5' },
    { name: 'Alex', uuid: '853c80ef-3c37-49fd-aa49-938b674adae6' },
  ]);
});

test('parseList: ohne UUIDs (einfaches "list")', () => {
  assert.deepEqual(parseList('There are 1 of a max of 16 players online: Notch').players, [{ name: 'Notch', uuid: null }]);
});

test('parseList: unbekanntes Format wirft Fehler', () => {
  assert.throws(() => parseList('Unknown or incomplete command'));
});

test('parseTps: NeoForge-Ausgabe mit Punkt', () => {
  const text = 'minecraft:overworld: 20.000 TPS (12.345 ms/tick)\nminecraft:the_nether: 20.000 TPS (0.500 ms/tick)\nOverall: 19.874 TPS (50.317 ms/tick)';
  assert.deepEqual(parseTps(text), { tps: 19.874, mspt: 50.317 });
});

test('parseTps: deutsches Zahlenformat mit Komma', () => {
  assert.deepEqual(parseTps('Overall: 20,000 TPS (3,250 ms/tick)'), { tps: 20, mspt: 3.25 });
});

test('parseTps: kein TPS-Befehl vorhanden', () => {
  assert.equal(parseTps('Unknown or incomplete command, see below for error'), null);
});
