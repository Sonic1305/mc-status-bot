import { execFile } from 'node:child_process';
import { escapeMarkdown } from 'discord.js';
import { t } from './i18n.js';
import { log } from './log.js';
import { getListeningProcess, isProcessAlive, killProcess } from './uptime.js';

// Ablauf eines Neustarts:
//   countdown  -> Spieler werden im Spiel gewarnt, danach schickt der Bot per RCON "stop"
//   restarting -> der Server fährt herunter; das Startskript (RESTART_SCRIPT_NAME) bzw. ein
//                 Dienst/Panel startet ihn neu; der Bot wartet, bis er wieder online ist
// Der Bot startet den Server nie selbst – er schickt nur "stop".
//
// Hänger-Absicherung: Manche Mods werfen beim Herunterfahren Fehler, danach beendet sich der
// Java-Prozess nicht (die Welt ist dann schon gespeichert). Der Bot merkt sich vor dem "stop"
// den Serverprozess und beendet genau diesen hart, wenn er nach RESTART_KILL_AFTER_MINUTES
// noch läuft. Das Startskript startet den Server danach normal neu.
//
// Meldungen haben einen Typ: 'restart' (Info, per ALERT_RESTARTS abschaltbar) oder 'problem' (immer).

export const COUNTDOWN_CHOICES = [0, 1, 5, 10]; // Auswahl bei /mc server restart
export const MAX_COUNTDOWN_MINUTES = 30;
const ANNOUNCE_AT_SECONDS = [600, 300, 120, 60, 30, 10, 5, 4, 3, 2, 1];
const INSTANT_DELAY_MS = 5000;
// So lange darf das Herunterfahren (Speichern mit vielen Mods) dauern, bevor es als fehlgeschlagen gilt.
const SHUTDOWN_TIMEOUT_MS = 3 * 60 * 1000;

const unixSeconds = (ms) => Math.floor(ms / 1000);

export function announcementText(seconds) {
  if (seconds <= 0) return t('ingame.restartNow');
  if (seconds >= 60) return t('ingame.restartInMinutes', { minutes: seconds / 60 });
  return t('ingame.restartInSeconds', { seconds });
}

/** Sekunden vor dem Neustart, zu denen im Spiel gewarnt wird (erste Warnung sofort). */
export function announcementSchedule(totalSeconds) {
  if (totalSeconds <= 0) return [];
  return [totalSeconds, ...ANNOUNCE_AT_SECONDS.filter((s) => s < totalSeconds)];
}

// Fester Text, keine Benutzereingabe – JSON.stringify sorgt für korrektes Escaping.
const tellraw = (text) => `tellraw @a ${JSON.stringify({ text: `[Server] ${text}`, color: 'gold', bold: true })}`;

export function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  return t('duration', { minutes: Math.floor(total / 60), seconds: String(total % 60).padStart(2, '0') });
}

/**
 * Zählt laufende Prozesse, die das Startskript ausführen (Windows: cmd.exe, sonst über ps).
 * Liefert null, wenn das nicht geprüft werden kann (kein Skript eingestellt, Fehler).
 */
export function countRestartScriptProcesses(scriptName) {
  return new Promise((resolve) => {
    // scriptName ist in config.js auf einen einfachen Dateinamen beschränkt (keine Anführungszeichen o. Ä.).
    if (!scriptName || !/^[\w .-]+\.(bat|cmd|sh)$/i.test(scriptName)) {
      resolve(null);
      return;
    }
    const done = (count) => resolve(Number.isFinite(count) ? count : null);
    if (process.platform === 'win32') {
      const command = "(Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | "
        + `Where-Object { $_.CommandLine -like '*${scriptName}*' } | Measure-Object).Count`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
        { timeout: 20000, windowsHide: true }, (err, stdout) => done(err ? NaN : Number.parseInt(String(stdout).trim(), 10)));
      return;
    }
    execFile('ps', ['-eo', 'args='], { timeout: 20000 }, (err, stdout) => done(err
      ? NaN
      : String(stdout).split('\n').filter((line) => line.includes(scriptName)).length));
  });
}

export class RestartManager {
  #timers = [];

  /**
   * @param deps.monitor  { snapshot, rconEnabled, rconExec(cmd), pauseRcon(bool) }
   * @param deps.notify   ({ text, type, ping }) => void – Meldung in den Meldungs-Channel
   * @param deps.refresh  () => Promise – Status-Nachricht sofort aktualisieren
   * @param deps.processes { getListeningProcess, isProcessAlive, killProcess } – für Tests austauschbar
   */
  constructor({ config, state, save, monitor, notify, refresh, processes = { getListeningProcess, isProcessAlive, killProcess } }) {
    this.config = config;
    this.state = state;
    this.save = save;
    this.monitor = monitor;
    this.notify = notify;
    this.refresh = refresh;
    this.processes = processes;
  }

  /** Liefert einen Grund, warum gerade kein Neustart möglich ist, sonst null. */
  checkAllowed(now = Date.now()) {
    if (this.config.restartEnabled === false) return t('restart.disabled');
    if (!this.monitor.rconEnabled) return t('restart.noRcon');
    const restart = this.state.restart;
    if (restart?.phase === 'countdown') return t('restart.alreadyPlanned', { time: `<t:${unixSeconds(restart.stopAt)}:R>` });
    if (restart?.phase === 'restarting') return t('restart.inProgress');
    if (this.monitor.snapshot.status !== 'online') return t('restart.notReachable');
    const cooldownMs = this.config.restartCooldownMinutes * 60 * 1000;
    if (this.state.lastRestartAt && now - this.state.lastRestartAt < cooldownMs) {
      return t('restart.cooldown', { time: `<t:${unixSeconds(this.state.lastRestartAt + cooldownMs)}:R>` });
    }
    return null;
  }

  /**
   * Plant einen Neustart. Liefert eine Fehlermeldung oder null.
   * quiet: keine Meldungen im Channel bei Start und Erfolg (geplante Neustarts) – Fehler werden trotzdem gemeldet.
   */
  start({ minutes, userId, userName, quiet = false }) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_COUNTDOWN_MINUTES) return t('restart.invalidCountdown');
    const blocked = this.checkAllowed();
    if (blocked) return blocked;

    const now = Date.now();
    const totalSeconds = minutes * 60;
    const stopAt = now + (totalSeconds > 0 ? totalSeconds * 1000 : INSTANT_DELAY_MS);
    this.state.restart = {
      phase: 'countdown', byId: userId, byName: userName, requestedAt: now, stopAt, stopSentAt: null, sawDown: false, quiet,
    };
    this.save();
    log.info(t('log.restartRequested', { by: userName, id: userId, minutes }));

    if (totalSeconds === 0) this.#say(announcementText(0));
    for (const seconds of announcementSchedule(totalSeconds)) {
      this.#schedule(stopAt - seconds * 1000 - now, () => {
        if (this.state.restart?.phase === 'countdown') this.#say(announcementText(seconds));
      });
    }
    this.#schedule(stopAt - now, () => this.#sendStop());

    if (!quiet) {
      const who = escapeMarkdown(userName);
      this.notify({
        type: 'restart',
        text: minutes
          ? t('alert.restartPlanned', { by: who, name: this.config.serverName, time: `<t:${unixSeconds(stopAt)}:R>` })
          : t('alert.restartNow', { by: who, name: this.config.serverName }),
      });
    }
    this.refresh();
    return null;
  }

  /** Bricht einen geplanten Neustart ab. Liefert eine Fehlermeldung oder null. */
  cancel({ userName }) {
    const restart = this.state.restart;
    if (!restart) return t('restart.nonePlanned');
    if (restart.phase !== 'countdown') return t('restart.tooLate');
    this.#clearTimers();
    this.state.restart = null;
    this.save();
    this.#say(t('ingame.restartCancelled'));
    log.info(t('log.restartCancelled', { by: userName }));
    this.notify({ type: 'restart', text: t('alert.restartCancelled', { by: escapeMarkdown(userName) }) });
    this.refresh();
    return null;
  }

  /** Beim Start des Bots: Ein Countdown aus dem vorherigen Bot-Prozess ist verloren; ein laufender Neustart geht weiter. */
  recoverAfterBotStart() {
    if (this.state.restart?.phase === 'countdown') {
      log.warn(t('log.restartDiscarded'));
      this.state.restart = null;
      this.save();
    } else if (this.state.restart?.phase === 'restarting') {
      this.monitor.pauseRcon?.(true);
    }
  }

  /** Beim Beenden des Bots: laufenden Countdown abbrechen, damit kein halber Neustart übrig bleibt. */
  abortOnShutdown() {
    if (this.state.restart?.phase !== 'countdown') return;
    this.#clearTimers();
    this.state.restart = null;
    this.#say(t('ingame.restartCancelled'));
  }

  /** Bei jeder Abfrage aufrufen: verfolgt einen laufenden Neustart. */
  async onPoll(snapshot, now = Date.now()) {
    const restart = this.state.restart;
    if (restart?.phase !== 'restarting') return;
    const reachable = (snapshot.status === 'online' || snapshot.status === 'degraded') && !snapshot.stale;
    const name = this.config.serverName;

    // Ist bekannt, welcher Prozess vorher lief, zählt dessen Ende – nicht, ob der Server noch auf Pings antwortet.
    // Ein Server, der beim Herunterfahren hängt, beantwortet Pings oft weiter.
    const serverProcess = restart.serverProcess;
    if (serverProcess && !restart.processGone) {
      const alive = await this.processes.isProcessAlive(serverProcess);
      if (alive === false) {
        restart.processGone = true;
        restart.sawDown = true;
        log.info(t('log.processEnded', { duration: formatDuration(now - restart.stopSentAt) }));
      } else if (alive === true) {
        const killAfterMs = this.config.restartKillAfterMinutes * 60 * 1000;
        if (killAfterMs > 0 && now - restart.stopSentAt >= killAfterMs) {
          await this.#killHungServer(restart, now);
          return;
        }
        if (killAfterMs === 0 && now - restart.stopSentAt >= SHUTDOWN_TIMEOUT_MS) this.#failStillRunning();
        return; // alter Prozess läuft noch: Server gilt nicht als "wieder da"
      }
      // alive === null: nicht prüfbar -> unten wie bisher am Ping entscheiden
    }

    if (!reachable) {
      restart.sawDown = true;
      const since = restart.killedAt ?? restart.stopSentAt;
      if (now - since >= this.config.restartTimeoutMinutes * 60 * 1000) {
        this.#end();
        this.state.offlineAlert = 'sent'; // Beim Wiederkommen gibt es dann "wieder online".
        log.warn(t('log.restartTimeout', { minutes: this.config.restartTimeoutMinutes }));
        this.notify({
          type: 'problem',
          text: t('alert.restartTimeout', { name, minutes: this.config.restartTimeoutMinutes, script: this.config.restartScriptName }),
          ping: true,
        });
      }
    } else if (restart.sawDown) {
      this.#end();
      this.state.lastRestartAt = now;
      log.info(t('log.restartDone', { duration: formatDuration(now - restart.stopSentAt) }));
      if (!restart.quiet) {
        this.notify({ type: 'restart', text: t('alert.restartDone', { name, duration: formatDuration(now - restart.stopSentAt) }) });
      }
    } else if (now - restart.stopSentAt >= SHUTDOWN_TIMEOUT_MS) {
      this.#failStillRunning();
    }
  }

  /** Server hängt nach "stop": genau den gemerkten Prozess hart beenden. */
  async #killHungServer(restart, now) {
    const name = this.config.serverName;
    const minutes = Math.round((now - restart.stopSentAt) / 60000);
    const { pid } = restart.serverProcess;
    const killed = await this.processes.killProcess(restart.serverProcess);
    if (killed) {
      restart.processGone = true;
      restart.sawDown = true;
      restart.killedAt = now;
      this.save();
      log.warn(t('log.processKilled', { pid, minutes }));
      this.notify({ type: 'problem', text: t('alert.processKilled', { name, minutes, script: this.config.restartScriptName }) });
      return;
    }
    this.#end();
    log.error(t('log.processKillFailed', { pid }));
    this.notify({ type: 'problem', text: t('alert.processKillFailed', { name }), ping: true });
  }

  #failStillRunning() {
    this.#end();
    log.warn(t('log.restartStillRunning'));
    this.notify({ type: 'problem', text: t('alert.restartStillRunning') });
  }

  /** Neustart-Phase beenden und RCON wieder freigeben. */
  #end() {
    this.state.restart = null;
    this.monitor.pauseRcon?.(false);
  }

  async #sendStop() {
    const restart = this.state.restart;
    if (restart?.phase !== 'countdown') return;
    this.#clearTimers();
    // Welcher Prozess ist der Server? Damit später genau dieser (und nur dieser) geprüft/beendet wird.
    const serverProcess = await this.processes.getListeningProcess(this.config.mcPort, { host: this.config.mcHost }).catch(() => null);
    if (!serverProcess) log.warn(t('log.processNotFound'));
    try {
      await this.monitor.rconExec('stop');
    } catch (err) {
      // Der Server trennt RCON beim Herunterfahren oft, bevor die Antwort kommt.
      log.warn(t('log.stopNoAnswer', { error: err.message }));
    }
    // Keine offene RCON-Verbindung, solange der Server herunterfährt.
    this.monitor.pauseRcon?.(true);
    this.state.restart = { ...restart, phase: 'restarting', stopSentAt: Date.now(), sawDown: false, serverProcess };
    this.save();
    log.info(t('log.stopSent', { pid: serverProcess?.pid ?? null }));
    await this.refresh();
  }

  #say(text) {
    this.monitor.rconExec(tellraw(text)).catch((err) => log.warn(t('log.announceFailed', { error: err.message })));
  }

  #schedule(delayMs, fn) {
    const onError = (err) => log.error(t('log.restartError'), err);
    const timer = setTimeout(() => {
      try {
        Promise.resolve(fn()).catch(onError);
      } catch (err) {
        onError(err);
      }
    }, Math.max(0, delayMs));
    this.#timers.push(timer);
  }

  #clearTimers() {
    this.#timers.forEach(clearTimeout);
    this.#timers = [];
  }
}
