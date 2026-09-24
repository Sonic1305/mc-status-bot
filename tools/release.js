#!/usr/bin/env node
// Veröffentlicht eine neue Version des Status-Bots auf GitHub.
//
//   npm run release -- 1.3.0 "Was ist neu (erscheint in Discord)"
//
// Ablauf: Prüfungen -> Tests -> Version setzen -> release-manifest.json erzeugen
//         -> Commit + Tag -> Push -> GitHub-Release. Die Bots auf den Host-PCs
//         finden das Release bei ihrer nächsten Prüfung und installieren es.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_FILE = 'release-manifest.json';

// Was auf den Host-PCs installiert wird: alles Getrackte außer Tests, Werkzeugen und Git-Dateien.
const EXCLUDE = [/^test\//, /^tools\//, /^\.github\//, /^\.gitattributes$/, /^\.gitignore$/, new RegExp(`^${MANIFEST_FILE}$`)];

function run(cmd, args, { capture = true } = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32' && cmd === 'npm',
  });
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const newer = (a, b) => {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

const [version, notes = ''] = process.argv.slice(2);
if (!version || !parse(version)) fail('Aufruf: npm run release -- <version> "Notizen"   (z. B. 1.3.0)');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (!pkg.updateRepo) fail('In package.json fehlt "updateRepo" (z. B. "name/mc-status-bot").');
if (!newer(version, pkg.version)) fail(`Neue Version muss größer sein als die aktuelle (v${pkg.version}).`);

// 1. Voraussetzungen
try {
  run('gh', ['auth', 'status']);
} catch {
  fail('GitHub-CLI ist nicht angemeldet – einmal "gh auth login" ausführen.');
}
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
if (branch !== 'main') fail(`Releases nur vom Branch "main" (aktuell: ${branch}).`);
if (run('git', ['status', '--porcelain']).trim()) fail('Es gibt nicht committete Änderungen – erst committen.');

// 2. Tests
console.log('▶ Tests …');
try {
  run('npm', ['test'], { capture: false });
} catch {
  fail('Tests fehlgeschlagen – kein Release.');
}

// 3. Version setzen (package.json + package-lock.json)
console.log(`▶ Version ${pkg.version} → ${version}`);
run('npm', ['version', version, '--no-git-tag-version']);

// 4. Manifest mit Prüfsummen aller ausgelieferten Dateien
const files = run('git', ['ls-files'])
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && !EXCLUDE.some((re) => re.test(f)))
  .sort();
const minNode = (pkg.engines?.node ?? '').replace(/^>=\s*/, '');
const manifest = {
  version,
  tag: `v${version}`,
  minNode: /^\d+\.\d+$/.test(minNode) ? `${minNode}.0` : minNode || undefined,
  createdAt: new Date().toISOString(),
  files: Object.fromEntries(files.map((f) => [f, sha256(f)])),
};
fs.writeFileSync(path.join(ROOT, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`▶ Manifest: ${files.length} Dateien`);

// 5. Commit, Tag, Push, Release
run('git', ['add', 'package.json', 'package-lock.json', MANIFEST_FILE]);
run('git', ['commit', '-m', `Release v${version}`]);
run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);
console.log('▶ Push …');
run('git', ['push', 'origin', 'main'], { capture: false });
run('git', ['push', 'origin', `v${version}`], { capture: false });
run('gh', ['release', 'create', `v${version}`, '--title', `v${version}`, '--notes', notes || `Version ${version}`, '--verify-tag'], { capture: false });

console.log(`\n✔ v${version} veröffentlicht. Die Bots installieren das Update bei ihrer nächsten Prüfung`);
console.log('  (spätestens nach UPDATE_CHECK_HOURS) oder sofort per /server update in Discord.');
