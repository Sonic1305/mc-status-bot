import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareVersions, dependencyFingerprint, isSafeUpdatePath, sha256, Updater, validateManifest } from '../src/updater.js';

const REPO = 'tester/mc-status-bot';
const config = { updateRepo: REPO, autoUpdate: true, updateCheckHours: 6 };

/** Legt einen Bot-Ordner mit Version 1.2.0 an. */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-'));
  const files = {
    'src/index.js': 'old index',
    'src/old.js': 'wird entfernt',
    'package.json': '{"version":"1.2.0"}',
    'package-lock.json': 'lock-1',
    'start-bot.bat': 'old bat\r\n',
    'README.md': 'unveraendert',
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  fs.writeFileSync(path.join(root, '.env'), 'DISCORD_TOKEN="geheim"');
  fs.writeFileSync(path.join(root, 'state.json'), '{"record":{"count":7}}');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'dep.txt'), 'alte Abhängigkeit');
  fs.mkdirSync(path.join(root, 'update'));
  fs.writeFileSync(path.join(root, 'update', 'installed-manifest.json'), JSON.stringify({
    version: '1.2.0', files: Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha256(Buffer.from(c))])),
  }));
  return root;
}

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (root, file) => fs.existsSync(path.join(root, file));

/** Simuliert GitHub (API + raw) für Release v1.3.0. */
function fakeGitHub({ newFiles, tamper = {}, latestTag = 'v1.3.0', depsHash }) {
  const manifest = {
    version: latestTag.slice(1),
    tag: latestTag,
    minNode: '20.6.0',
    ...(depsHash ? { depsHash } : {}),
    files: Object.fromEntries(Object.entries(newFiles).map(([f, c]) => [f, sha256(Buffer.from(c))])),
  };
  const raw = `https://raw.githubusercontent.com/${REPO}/${latestTag}/`;
  const routes = new Map([
    [`https://api.github.com/repos/${REPO}/releases/latest`, JSON.stringify({ tag_name: latestTag, body: 'Neu: Tests', html_url: 'x' })],
    [`${raw}release-manifest.json`, JSON.stringify(manifest)],
    ...Object.entries(newFiles).map(([f, c]) => [raw + f, tamper[f] ?? c]),
  ]);
  return async (url) => (routes.has(url) ? new Response(routes.get(url)) : new Response('not found', { status: 404 }));
}

const NEW_FILES = {
  'src/index.js': 'new index',
  'src/new.js': 'neue Datei',
  'package.json': '{"version":"1.3.0"}',
  'package-lock.json': 'lock-1',
  'start-bot.bat': 'new bat\r\n',
  'README.md': 'unveraendert',
};

test('Versionen und Pfade', () => {
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  for (const good of ['src/index.js', '.env.example', 'server-startskript/start-mit-neustart.bat', 'README.md']) {
    assert.ok(isSafeUpdatePath(good), good);
  }
  for (const bad of ['../evil.js', 'src/../../x', './x.js', 'src/./x.js', '.env', '.env.local', '.ENV', 'state.json', 'node_modules/x/y.js',
    'update/rollback.bat', '.git/config', 'C:/x', 'a b.js', '/abs.js', 'src\\x.js']) {
    assert.equal(isSafeUpdatePath(bad), false, bad);
  }
});

test('Manifest-Prüfung', () => {
  const ok = { version: '1.3.0', files: { 'src/index.js': 'a'.repeat(64), 'package.json': 'b'.repeat(64), 'start-bot.bat': 'c'.repeat(64) } };
  assert.equal(validateManifest(ok, '1.3.0'), ok);
  assert.throws(() => validateManifest(ok, '1.4.0'), /erwartet/);
  assert.throws(() => validateManifest({ ...ok, files: { ...ok.files, '.env': 'd'.repeat(64) } }), /Unzulässiger Pfad/);
  assert.throws(() => validateManifest({ ...ok, files: { ...ok.files, 'src/x.js': 'kaputt' } }), /Prüfsumme/);
  assert.throws(() => validateManifest({ ...ok, files: { 'src/index.js': 'a'.repeat(64) } }), /unvollständig/);
  assert.throws(() => validateManifest({ ...ok, minNode: '99.0.0' }, null, '22.15.0'), /Node\.js 99/);
});

test('Update installieren und per rollback.bat zurückrollen', async () => {
  const root = makeRoot();
  try {
    const updater = new Updater({ config, currentVersion: '1.2.0', rootDir: root, fetchImpl: fakeGitHub({ newFiles: NEW_FILES }), npmCi: async () => assert.fail('npm ci unnötig') });
    const result = await updater.checkAndInstall();
    assert.equal(result.status, 'installed');
    assert.equal(result.version, '1.3.0');

    // neue Dateien da, entfernte weg, laufendes Startskript nur als .new
    assert.equal(read(root, 'src/index.js'), 'new index');
    assert.equal(read(root, 'src/new.js'), 'neue Datei');
    assert.equal(exists(root, 'src/old.js'), false);
    assert.equal(read(root, 'start-bot.bat'), 'old bat\r\n');
    assert.equal(read(root, 'start-bot.bat.new'), 'new bat\r\n');
    // Geschütztes unangetastet
    assert.equal(read(root, '.env'), 'DISCORD_TOKEN="geheim"');
    assert.equal(read(root, 'state.json'), '{"record":{"count":7}}');
    assert.equal(read(root, 'node_modules/dep.txt'), 'alte Abhängigkeit');
    // Sicherung, Marker, Manifest
    assert.equal(read(root, 'update/backup/src/index.js'), 'old index');
    assert.equal(read(root, 'update/backup/src/old.js'), 'wird entfernt');
    assert.equal(exists(root, 'update/backup/README.md'), false, 'unveränderte Dateien werden nicht gesichert');
    assert.equal(JSON.parse(read(root, 'update/pending-healthcheck.json')).to, '1.3.0');
    assert.equal(JSON.parse(read(root, 'update/installed-manifest.json')).version, '1.3.0');
    assert.equal(exists(root, 'update/staging'), false);

    if (process.platform === 'win32') {
      // Das erzeugte rollback.bat wirklich ausführen, so wie start-bot.bat es nach einem Absturz tut.
      execFileSync('cmd.exe', ['/c', path.join(root, 'update', 'rollback.bat')], { stdio: 'ignore' });
      assert.equal(read(root, 'src/index.js'), 'old index');
      assert.equal(read(root, 'src/old.js'), 'wird entfernt');
      assert.equal(exists(root, 'src/new.js'), false);
      assert.equal(read(root, 'start-bot.bat.new'), 'old bat\r\n');
      assert.equal(exists(root, 'update/pending-healthcheck.json'), false);
      assert.equal(JSON.parse(read(root, 'update/installed-manifest.json')).version, '1.2.0');
      assert.equal(read(root, 'update/skip-version.txt').trim(), '1.3.0');

      // Die kaputte Version wird nicht automatisch erneut installiert, manuell aber schon.
      const again = new Updater({ config, currentVersion: '1.2.0', rootDir: root, fetchImpl: fakeGitHub({ newFiles: NEW_FILES }) });
      assert.deepEqual(again.takeRollbackNotice(), { from: '1.2.0', to: '1.3.0' });
      assert.equal((await again.checkAndInstall()).status, 'skipped');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Falsche Prüfsumme: nichts wird verändert', async () => {
  const root = makeRoot();
  try {
    const fetchImpl = fakeGitHub({ newFiles: NEW_FILES, tamper: { 'src/new.js': 'manipuliert' } });
    const updater = new Updater({ config, currentVersion: '1.2.0', rootDir: root, fetchImpl });
    await assert.rejects(updater.checkAndInstall(), /Prüfsumme stimmt nicht: src\/new\.js/);
    assert.equal(read(root, 'src/index.js'), 'old index');
    assert.equal(exists(root, 'src/new.js'), false);
    assert.equal(exists(root, 'update/pending-healthcheck.json'), false);
    assert.equal(exists(root, 'update/staging'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Geänderte Abhängigkeiten: npm ci in staging, node_modules wird getauscht und beim Rollback zurückgeholt', async () => {
  const root = makeRoot();
  try {
    let ciDir = null;
    const npmCi = async (dir) => {
      ciDir = dir;
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.writeFileSync(path.join(dir, 'node_modules', 'dep.txt'), 'neue Abhängigkeit');
    };
    const newFiles = { ...NEW_FILES, 'package-lock.json': 'lock-2' };
    const updater = new Updater({ config, currentVersion: '1.2.0', rootDir: root, fetchImpl: fakeGitHub({ newFiles }), npmCi });
    await updater.checkAndInstall();
    assert.equal(ciDir, path.join(root, 'update', 'staging'));
    assert.equal(read(root, 'node_modules/dep.txt'), 'neue Abhängigkeit');
    assert.equal(read(root, 'update/backup/node_modules/dep.txt'), 'alte Abhängigkeit');

    if (process.platform === 'win32') {
      execFileSync('cmd.exe', ['/c', path.join(root, 'update', 'rollback.bat')], { stdio: 'ignore' });
      assert.equal(read(root, 'node_modules/dep.txt'), 'alte Abhängigkeit');
      assert.equal(read(root, 'package-lock.json'), 'lock-1');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Kein Update: aktuell, kein Release, ausgeschaltet, beschäftigt', async () => {
  const root = makeRoot();
  try {
    const current = new Updater({ config, currentVersion: '1.3.0', rootDir: root, fetchImpl: fakeGitHub({ newFiles: NEW_FILES }) });
    assert.equal((await current.checkAndInstall()).status, 'up-to-date');

    const none = new Updater({ config, currentVersion: '1.2.0', rootDir: root, fetchImpl: async () => new Response('', { status: 404 }) });
    assert.equal((await none.checkAndInstall()).status, 'none');

    const off = new Updater({ config: { ...config, autoUpdate: false }, currentVersion: '1.2.0', rootDir: root, fetchImpl: fakeGitHub({ newFiles: NEW_FILES }) });
    const offResult = await off.checkAndInstall({ manual: true });
    assert.equal(offResult.status, 'disabled');
    assert.equal(offResult.latest.version, '1.3.0');

    const busy = new Updater({ config, currentVersion: '1.2.0', rootDir: root, isBusy: () => true, fetchImpl: fakeGitHub({ newFiles: NEW_FILES }) });
    assert.equal((await busy.checkAndInstall()).status, 'busy');
    assert.equal(read(root, 'src/index.js'), 'old index');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Gesund-Meldung entfernt Marker und Sperre', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, 'update', 'pending-healthcheck.json'), JSON.stringify({ from: '1.2.0', to: '1.3.0', notes: 'x' }));
    fs.writeFileSync(path.join(root, 'update', 'skip-version.txt'), '1.3.0');
    const updater = new Updater({ config, currentVersion: '1.3.0', rootDir: root });
    assert.equal(updater.confirmHealthy().to, '1.3.0');
    assert.equal(exists(root, 'update/pending-healthcheck.json'), false);
    assert.equal(exists(root, 'update/skip-version.txt'), false);
    assert.equal(updater.confirmHealthy(), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const lockJson = ({ version, lodash = '4.17.21', license }) => JSON.stringify({
  name: 'mc-status-bot', version, lockfileVersion: 3, requires: true,
  packages: {
    '': { name: 'mc-status-bot', version, ...(license ? { license } : {}), dependencies: { lodash: `^${lodash}` } },
    'node_modules/lodash': { version: lodash, resolved: `https://registry.npmjs.org/lodash/-/lodash-${lodash}.tgz` },
  },
}, null, 2);

test('Abhängigkeits-Fingerabdruck ignoriert eigene Version und Lizenz, erkennt Paketänderungen', () => {
  const base = dependencyFingerprint(lockJson({ version: '1.2.2' }));
  assert.equal(dependencyFingerprint(lockJson({ version: '1.2.3', license: 'MIT' })), base);
  assert.notEqual(dependencyFingerprint(lockJson({ version: '1.2.2', lodash: '4.17.22' })), base);
  const reordered = JSON.parse(lockJson({ version: '1.2.2' }));
  reordered.packages = Object.fromEntries(Object.entries(reordered.packages).reverse());
  assert.equal(dependencyFingerprint(JSON.stringify(reordered)), base, 'Reihenfolge egal');
});

test('Nur Versionsnummer im Lockfile geändert: kein npm ci', async () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, 'package-lock.json'), lockJson({ version: '1.2.0' }));
    const newLock = lockJson({ version: '1.3.0', license: 'MIT' });
    const updater = new Updater({
      config, currentVersion: '1.2.0', rootDir: root,
      fetchImpl: fakeGitHub({ newFiles: { ...NEW_FILES, 'package-lock.json': newLock }, depsHash: dependencyFingerprint(newLock) }),
      npmCi: async () => assert.fail('npm ci darf nicht laufen'),
    });
    assert.equal((await updater.checkAndInstall()).status, 'installed');
    assert.equal(read(root, 'package-lock.json'), newLock);
    assert.equal(read(root, 'node_modules/dep.txt'), 'alte Abhängigkeit', 'node_modules bleibt');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pakete geändert (depsHash anders): npm ci läuft', async () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, 'package-lock.json'), lockJson({ version: '1.2.0' }));
    const newLock = lockJson({ version: '1.3.0', lodash: '4.17.22' });
    let ran = false;
    const updater = new Updater({
      config, currentVersion: '1.2.0', rootDir: root,
      fetchImpl: fakeGitHub({ newFiles: { ...NEW_FILES, 'package-lock.json': newLock }, depsHash: dependencyFingerprint(newLock) }),
      npmCi: async (dir) => { ran = true; fs.mkdirSync(path.join(dir, 'node_modules')); },
    });
    await updater.checkAndInstall();
    assert.ok(ran);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});