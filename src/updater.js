import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

// Auto-Updater
//
// Ablauf:
//  1. GitHub-API: neuestes Release des Repos abfragen (öffentliches Repo, kein Token nötig).
//  2. release-manifest.json aus dem Release-Tag laden: Version + SHA-256 jeder Datei.
//  3. Alle Dateien vom Tag laden, Prüfsummen prüfen, in update/staging ablegen.
//  4. Bei geänderten Abhängigkeiten "npm ci" in staging.
//  5. Alte Dateien nach update/backup sichern, update/rollback.bat erzeugen, neue Dateien einspielen.
//  6. Prozess mit Exit-Code 3 beenden – start-bot.bat startet sofort die neue Version.
//  7. Stürzt die neue Version ab, bevor sie sich als gesund meldet, ruft start-bot.bat
//     update/rollback.bat auf (erzeugt von der alten, funktionierenden Version).
//
// .env, state.json, logs/, node_modules/ (außer bei Abhängigkeits-Updates) und der
// Minecraft-Serverordner werden nie angefasst.

export const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const EXIT_UPDATE_INSTALLED = 3;
export const MANIFEST_FILE = 'release-manifest.json';

const REQUIRED_FILES = ['src/index.js', 'package.json', 'start-bot.bat'];
// .env und Varianten wie .env.local sind tabu – nur die Vorlage .env.example darf aktualisiert werden.
const PROTECTED_PATHS = [/^\.env(\.(?!example$)[^/]*)?$/i, /^state\.json/i, /^logs\//i, /^node_modules\//i, /^update\//i, /^\.git(\/|$)/i];
// Nur einfache Pfade: keine Leerzeichen, keine Laufwerke, keine "."/".."-Segmente – die Pfade landen auch in rollback.bat.
const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const NPM_TIMEOUT_MS = 5 * 60 * 1000;
// start-bot.bat läuft gerade und darf nicht direkt überschrieben werden (cmd liest Batch-Dateien zeilenweise nach).
const RUNNING_SCRIPT = 'start-bot.bat';

export function parseVersion(text) {
  const match = VERSION_RE.exec(String(text).trim());
  if (!match) throw new Error(`Ungültige Versionsnummer: ${text}`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a).split('.').map(Number);
  const pb = parseVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

export function isSafeUpdatePath(p) {
  return SAFE_PATH.test(p)
    && !p.split('/').some((segment) => segment === '.' || segment === '..')
    && !PROTECTED_PATHS.some((re) => re.test(p));
}

export function validateManifest(manifest, expectedVersion, nodeVersion = process.versions.node) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Update-Manifest ist ungültig.');
  const version = parseVersion(manifest.version);
  if (expectedVersion && version !== parseVersion(expectedVersion)) {
    throw new Error(`Manifest gehört zu v${version}, erwartet war v${expectedVersion}.`);
  }
  if (!manifest.files || typeof manifest.files !== 'object') throw new Error('Update-Manifest enthält keine Dateiliste.');
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!isSafeUpdatePath(file)) throw new Error(`Unzulässiger Pfad im Update: ${file}`);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Ungültige Prüfsumme für ${file}`);
  }
  for (const file of REQUIRED_FILES) {
    if (!manifest.files[file]) throw new Error(`Update ist unvollständig: ${file} fehlt.`);
  }
  if (manifest.minNode && compareVersions(nodeVersion, manifest.minNode) < 0) {
    throw new Error(`v${version} braucht Node.js ${manifest.minNode} oder neuer (installiert: ${nodeVersion}).`);
  }
  return manifest;
}

const toWin = (p) => p.replaceAll('/', '\\');

/** Erzeugt update/rollback.bat, das den Stand vor dem Update wiederherstellt. */
export function buildRollbackScript({ from, to, backedUp, added, nodeModules, hadInstalledManifest }) {
  const lines = [
    '@echo off',
    `rem Automatisch erzeugt beim Update von v${from} auf v${to}.`,
    `rem Stellt v${from} wieder her, falls v${to} nicht startet.`,
    'cd /d "%~dp0.."',
  ];
  for (const file of backedUp) {
    const dir = path.posix.dirname(file);
    if (dir !== '.') lines.push(`if not exist "${toWin(dir)}" mkdir "${toWin(dir)}"`);
    const target = file === RUNNING_SCRIPT ? `${RUNNING_SCRIPT}.new` : toWin(file);
    lines.push(`copy /y "update\\backup\\${toWin(file)}" "${target}" >nul`);
  }
  for (const file of added) lines.push(`if exist "${toWin(file)}" del /q "${toWin(file)}"`);
  if (nodeModules) {
    lines.push(
      'if exist "update\\backup\\node_modules" (',
      '  if exist "node_modules" rmdir /s /q "node_modules"',
      '  move "update\\backup\\node_modules" "node_modules" >nul',
      ')',
    );
  }
  lines.push(hadInstalledManifest
    ? 'copy /y "update\\backup\\installed-manifest.json" "update\\installed-manifest.json" >nul'
    : 'if exist "update\\installed-manifest.json" del /q "update\\installed-manifest.json"');
  lines.push(
    `>"update\\skip-version.txt" echo ${to}`,
    `>"update\\rolled-back.txt" echo ${from} ${to}`,
    'if exist "update\\pending-healthcheck.json" del /q "update\\pending-healthcheck.json"',
    `echo Version ${from} wurde wiederhergestellt.`,
  );
  return `${lines.join('\r\n')}\r\n`;
}

function runNpmCi(cwd) {
  return new Promise((resolve, reject) => {
    // Feste Befehlszeile ohne Benutzereingaben; shell ist unter Windows für npm.cmd nötig.
    const child = spawn('npm ci --omit=dev --no-audit --no-fund', { cwd, shell: true, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('npm ci: Zeitüberschreitung'));
    }, NPM_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm ci ist fehlgeschlagen (Code ${code}).`));
    });
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export class Updater {
  #installing = false;
  #timer = null;
  #lastLoggedSkip = null;

  /**
   * @param opts.isBusy   () => boolean – true verschiebt die Installation (z. B. laufender Server-Neustart)
   * @param opts.onInstalled (result) => void – wird nach einer automatischen Installation aufgerufen
   */
  constructor({ config, currentVersion, isBusy = () => false, onInstalled = () => {}, rootDir = ROOT_DIR, fetchImpl = globalThis.fetch, npmCi = runNpmCi }) {
    this.config = config;
    this.currentVersion = parseVersion(currentVersion);
    this.isBusy = isBusy;
    this.onInstalled = onInstalled;
    this.rootDir = rootDir;
    this.updateDir = path.join(rootDir, 'update');
    this.fetch = fetchImpl;
    this.npmCi = npmCi;
  }

  get enabled() {
    return this.config.autoUpdate && Boolean(this.config.updateRepo);
  }

  /** Startet die regelmäßige Prüfung (erste Prüfung nach einer Minute). */
  start() {
    if (!this.enabled) {
      log.info(this.config.updateRepo ? 'Auto-Update ist ausgeschaltet (AUTO_UPDATE=false).' : 'Auto-Update: kein Repository konfiguriert.');
      return;
    }
    log.info(`Auto-Update aktiv: prüft github.com/${this.config.updateRepo} alle ${this.config.updateCheckHours} h.`);
    const run = async () => {
      try {
        const result = await this.checkAndInstall();
        if (result.status === 'installed') this.onInstalled(result);
        else if (result.status === 'busy') {
          this.#timer = setTimeout(run, 5 * 60 * 1000); // bald erneut versuchen
          return;
        }
      } catch (err) {
        log.warn(`Update-Prüfung fehlgeschlagen: ${err.message}`);
      }
      this.#timer = setTimeout(run, this.config.updateCheckHours * 3600 * 1000);
    };
    this.#timer = setTimeout(run, 60 * 1000);
  }

  stop() {
    clearTimeout(this.#timer);
  }

  /** Fragt das neueste Release auf GitHub ab. */
  async checkLatest() {
    const url = `https://api.github.com/repos/${this.config.updateRepo}/releases/latest`;
    const response = await this.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mc-status-bot-updater' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (response.status === 404) return null; // noch kein Release
    if (!response.ok) throw new Error(`GitHub antwortet mit ${response.status}`);
    const release = await response.json();
    const version = parseVersion(release.tag_name);
    return {
      version,
      tag: release.tag_name,
      notes: String(release.body ?? '').trim(),
      url: release.html_url,
      newer: compareVersions(version, this.currentVersion) > 0,
    };
  }

  /**
   * Prüft und installiert bei Bedarf.
   * status: 'disabled' | 'none' | 'up-to-date' | 'skipped' | 'busy' | 'installed'
   */
  async checkAndInstall({ manual = false } = {}) {
    if (!this.config.updateRepo) return { status: 'disabled' };
    if (this.#installing) return { status: 'busy' };
    const latest = await this.checkLatest();
    if (!latest) return { status: 'none' };
    if (!latest.newer) return { status: 'up-to-date', latest };

    const skip = this.#readSkipVersion();
    if (!manual && skip === latest.version) {
      if (this.#lastLoggedSkip !== skip) {
        log.warn(`v${skip} wird übersprungen – sie ist nach dem letzten Installationsversuch nicht gestartet.`);
        this.#lastLoggedSkip = skip;
      }
      return { status: 'skipped', latest };
    }
    if (!this.config.autoUpdate) return { status: 'disabled', latest };
    if (this.isBusy()) return { status: 'busy', latest };

    const result = await this.install(latest);
    return { status: 'installed', latest, ...result };
  }

  async install(release) {
    if (this.#installing) throw new Error('Es läuft bereits eine Installation.');
    this.#installing = true;
    const staging = path.join(this.updateDir, 'staging');
    const backup = path.join(this.updateDir, 'backup');
    const base = `https://raw.githubusercontent.com/${this.config.updateRepo}/${encodeURIComponent(release.tag)}/`;
    let applied = null;

    try {
      log.info(`Lade Update v${release.version} …`);
      const manifest = validateManifest(await this.#download(base + MANIFEST_FILE).then((b) => JSON.parse(b.toString('utf8'))), release.version);
      const files = Object.entries(manifest.files);

      // 1. Herunterladen und prüfen
      fs.rmSync(staging, { recursive: true, force: true });
      await this.#parallel(files, 4, async ([file, hash]) => {
        const data = await this.#download(base + file.split('/').map(encodeURIComponent).join('/'));
        if (sha256(data) !== hash) throw new Error(`Prüfsumme stimmt nicht: ${file}`);
        const target = path.join(staging, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      });

      // 2. Abhängigkeiten
      const currentLock = path.join(this.rootDir, 'package-lock.json');
      const lockChanged = !fs.existsSync(currentLock) || sha256(fs.readFileSync(currentLock)) !== manifest.files['package-lock.json'];
      if (lockChanged && manifest.files['package-lock.json']) {
        log.info('Abhängigkeiten haben sich geändert – führe npm ci aus …');
        await this.npmCi(staging);
      }
      const replaceNodeModules = lockChanged && fs.existsSync(path.join(staging, 'node_modules'));

      // 3. Was ändert sich?
      const installedManifestFile = path.join(this.updateDir, 'installed-manifest.json');
      const previous = readJson(installedManifestFile);
      const exists = (file) => fs.existsSync(path.join(this.rootDir, file));
      const changed = files
        .filter(([file, hash]) => !exists(file) || sha256(fs.readFileSync(path.join(this.rootDir, file))) !== hash)
        .map(([file]) => file);
      const removed = previous?.files
        ? Object.keys(previous.files).filter((file) => !manifest.files[file] && isSafeUpdatePath(file) && exists(file))
        : [];
      const backedUp = [...changed.filter(exists), ...removed];
      const added = changed.filter((file) => !exists(file) && file !== RUNNING_SCRIPT);

      // 4. Sicherung + Rollback-Skript
      fs.rmSync(backup, { recursive: true, force: true });
      fs.mkdirSync(backup, { recursive: true });
      for (const file of backedUp) {
        const target = path.join(backup, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(this.rootDir, file), target);
      }
      if (previous) fs.copyFileSync(installedManifestFile, path.join(backup, 'installed-manifest.json'));
      fs.writeFileSync(path.join(this.updateDir, 'rollback.bat'), buildRollbackScript({
        from: this.currentVersion, to: manifest.version, backedUp, added, nodeModules: replaceNodeModules, hadInstalledManifest: Boolean(previous),
      }));

      // 5. Einspielen
      applied = { backedUp, added, removed, nodeModulesMoved: false };
      for (const file of changed) {
        const target = file === RUNNING_SCRIPT ? path.join(this.rootDir, `${RUNNING_SCRIPT}.new`) : path.join(this.rootDir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(staging, file), target);
      }
      for (const file of removed) fs.rmSync(path.join(this.rootDir, file), { force: true });
      if (replaceNodeModules) {
        const live = path.join(this.rootDir, 'node_modules');
        if (fs.existsSync(live)) fs.renameSync(live, path.join(backup, 'node_modules'));
        applied.nodeModulesMoved = true;
        fs.renameSync(path.join(staging, 'node_modules'), live);
      }
      fs.writeFileSync(installedManifestFile, JSON.stringify(manifest, null, 2));
      fs.writeFileSync(path.join(this.updateDir, 'pending-healthcheck.json'), JSON.stringify({
        from: this.currentVersion, to: manifest.version, notes: release.notes ?? '', at: Date.now(),
      }, null, 2));
      fs.rmSync(staging, { recursive: true, force: true });
      log.info(`Update v${manifest.version} installiert (${changed.length} Dateien geändert${replaceNodeModules ? ', Abhängigkeiten erneuert' : ''}).`);
      return { version: manifest.version, changedFiles: changed.length };
    } catch (err) {
      if (applied) this.#restore(applied, backup);
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    } finally {
      this.#installing = false;
    }
  }

  /** Schlägt das Einspielen fehl, sofort den alten Stand zurückholen. */
  #restore({ backedUp, added, nodeModulesMoved }, backup) {
    log.warn('Einspielen fehlgeschlagen – stelle alte Dateien wieder her.');
    for (const file of backedUp) {
      try {
        const target = path.join(this.rootDir, file === RUNNING_SCRIPT ? `${RUNNING_SCRIPT}.new` : file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(backup, file), target);
      } catch (err) {
        log.error(`Konnte ${file} nicht wiederherstellen: ${err.message}`);
      }
    }
    for (const file of added) fs.rmSync(path.join(this.rootDir, file), { force: true });
    fs.rmSync(path.join(this.rootDir, `${RUNNING_SCRIPT}.new`), { force: true });
    if (nodeModulesMoved && fs.existsSync(path.join(backup, 'node_modules'))) {
      fs.rmSync(path.join(this.rootDir, 'node_modules'), { recursive: true, force: true });
      fs.renameSync(path.join(backup, 'node_modules'), path.join(this.rootDir, 'node_modules'));
    }
  }

  /** Nach dem Start: Meldet eine frisch installierte Version sich gesund, Marker entfernen. */
  confirmHealthy() {
    const file = path.join(this.updateDir, 'pending-healthcheck.json');
    const pending = readJson(file);
    if (!pending) return null;
    fs.rmSync(file, { force: true });
    fs.rmSync(path.join(this.updateDir, 'skip-version.txt'), { force: true });
    return pending;
  }

  /** Nach dem Start: Wurde das letzte Update zurückgerollt? */
  takeRollbackNotice() {
    const file = path.join(this.updateDir, 'rolled-back.txt');
    if (!fs.existsSync(file)) return null;
    const [from, to] = fs.readFileSync(file, 'utf8').trim().split(/\s+/);
    fs.rmSync(file, { force: true });
    return { from, to };
  }

  #readSkipVersion() {
    try {
      return parseVersion(fs.readFileSync(path.join(this.updateDir, 'skip-version.txt'), 'utf8'));
    } catch {
      return null;
    }
  }

  async #download(url) {
    const response = await this.fetch(url, {
      headers: { 'User-Agent': 'mc-status-bot-updater' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async #parallel(items, limit, worker) {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await worker(queue.shift());
    });
    await Promise.all(runners);
  }
}
