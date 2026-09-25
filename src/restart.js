import { execFile } from 'node:child_process';
import { escapeMarkdown } from 'discord.js';
import { log } from './log.js';
import { getListeningProcess, isProcessAlive, killProcess } from './uptime.js';

// Ablauf eines Neustarts:
//   countdown  -> Spieler werden im Spiel gewarnt, danach schickt der Bot per RCON "stop"
//   restarting -> der Server fährt herunter; das Startskript (start-mit-neustart.bat)
//                 startet ihn neu; der Bot wartet, bis er wieder online ist
// Der Bot startet den Server nie selbst – er schickt nur "stop".
//
// Hänger-Absicherung: Manche Mods werfen beim Herunterfahren Fehler, danach beendet sich der
// Java-Prozess nicht (die Welt ist dann schon gespeichert). Der Bot merkt sich vor dem "stop"
// den Serverprozess und beendet genau diesen hart, wenn er nach RESTART_KILL_AFTER_MINUTES
// noch läuft. Das Startskript startet den Server danach normal neu.

export const COUNTDOWN_CHOICES = [0, 1, 5, 10]; // Auswahl bei /server neustart
export const MAX_COUNTDOWN_MINUTES = 30;
const ANNOUNCE_AT_SECONDS = [600, 300, 120, 60, 30, 10, 5, 4, 3, 2, 1];
const INSTANT_DELAY_MS = 5000;
// So lange darf das Herunterfahren (Speichern mit vielen Mods) dauern, bevor es als fehlgeschlagen gilt.
const SHUTDOWN_TIMEOUT_MS = 3 * 60 * 1000;

const unixSeconds = (ms) => Math.floor(ms / 1000);

export function announcementText(seconds) {
  if (seconds <= 0) return 'Server startet JETZT neu - bitte in ein paar Minuten wieder verbinden.';
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return `Server-Neustart in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}!`;
  }
  return `Server-Neustart in ${seconds} ${seconds === 1 ? 'Sekunde' : 'Sekunden'}!`;
}

/** Sekunden vor dem Neustart, zu denen im Spiel gewarnt wird (erste Warnung sofort). */
export function announcementSchedule(totalSeconds) {
  if (totalSeconds <= 0) return [];
  return [totalSeconds, ...ANNOUNCE_AT_SECONDS.filter((s) => s < totalSeconds)];
}

// Fester Text, keine Benutzereingabe – JSON.stringify sorgt für korrektes Escaping.
const tellraw = (text) => `tellraw @a ${JSON.stringify({ text: `[Server] ${text}`, color: 'gold', bold: true })}`;

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} Min.`;
}

/**
 * Zählt laufende cmd.exe-Prozesse, die das Startskript ausführen.
 * Liefert null, wenn das nicht geprüft werden kann (kein Windows, Fehler).
 */
export function countRestartScriptProcesses(scriptName) {
  return new Promise((resolve) => {
    // scriptName ist in config.js auf einen einfachen Dateinamen beschränkt (keine Anführungszeichen o. Ä.).
    if (process.platform !== 'win32' || !/^[\w .-]+\.(bat|cmd)$/i.test(scriptName)) {
      resolve(null);
      return;
    }
    const command = "(Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | "
      + `Where-Object { $_.CommandLine -like '*${scriptName}*' } | Measure-Object).Count`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 20000, windowsHide: true }, (err, stdout) => {
        const count = Number.parseInt(String(stdout).trim(), 10);
        resolve(err || !Number.isFinite(count) ? null : count);
      });
  });
}

export class RestartManager {
  #timers = [];

  /**
   * @param deps.monitor  { snapshot, rconEnabled, rconExec(cmd), pauseRcon(bool) }
   * @param deps.notify   (alert) => void – Meldung in den Meldungs-Channel
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
    if (!this.monitor.rconEnabled) return 'Ohne RCON (RCON_PASSWORD in der .env) kann der Bot den Server nicht neu starten.';
    const restart = this.state.restart;
    if (restart?.phase === 'countdown') {
      return `Es ist bereits ein Neustart geplant (<t:${unixSeconds(restart.stopAt)}:R>). Abbrechen mit \`/server neustart-abbrechen\`.`;
    }
    if (restart?.phase === 'restarting') return 'Der Server startet gerade neu.';
    if (this.monitor.snapshot.status !== 'online') {
      return 'Der Server ist gerade nicht (voll) erreichbar – ohne funktionierendes RCON kann kein sauberer Neustart ausgelöst werden.';
    }
    const cooldownMs = this.config.restartCooldownMinutes * 60 * 1000;
    if (this.state.lastRestartAt && now - this.state.lastRestartAt < cooldownMs) {
      return `Der letzte Neustart ist erst kurz her. Wieder möglich <t:${unixSeconds(this.state.lastRestartAt + cooldownMs)}:R>.`;
    }
    return null;
  }

  /**
   * Plant einen Neustart. Liefert eine Fehlermeldung oder null.
   * quiet: keine Meldungen im Channel bei Start und Erfolg (geplante Neustarts) – Fehler werden trotzdem gemeldet.
   */
  start({ minutes, userId, userName, quiet = false }) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_COUNTDOWN_MINUTES) return 'Ungültiger Countdown.';
    const blocked = this.checkAllowed();
    if (blocked) return blocked;

    const now = Date.now();
    const totalSeconds = minutes * 60;
    const stopAt = now + (totalSeconds > 0 ? totalSeconds * 1000 : INSTANT_DELAY_MS);
    this.state.restart = {
      phase: 'countdown', byId: userId, byName: userName, requestedAt: now, stopAt, stopSentAt: null, sawDown: false, quiet,
    };
    this.save();
    log.info(`Neustart angefordert von ${userName}${userId ? ` (${userId})` : ''} – ${minutes ? `in ${minutes} Min.` : 'sofort'}.`);

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
        text: minutes
          ? `🔄 **Neustart geplant** von ${who}: ${this.config.serverName} startet <t:${unixSeconds(stopAt)}:R> neu.`
          : `🔄 **${this.config.serverName} wird jetzt neu gestartet** (ausgelöst von ${who}).`,
      });
    }
    this.refresh();
    return null;
  }

  /** Bricht einen geplanten Neustart ab. Liefert eine Fehlermeldung oder null. */
  cancel({ userName }) {
    const restart = this.state.restart;
    if (!restart) return 'Es ist kein Neustart geplant.';
    if (restart.phase !== 'countdown') return 'Zu spät – der Server fährt bereits herunter.';
    this.#clearTimers();
    this.state.restart = null;
    this.save();
    this.#say('Neustart abgebrochen.');
    log.info(`Neustart abgebrochen von ${userName}.`);
    this.notify({ text: `❎ Neustart abgebrochen von ${escapeMarkdown(userName)}.` });
    this.refresh();
    return null;
  }

  /** Beim Start des Bots: Ein Countdown aus dem vorherigen Bot-Prozess ist verloren; ein laufender Neustart geht weiter. */
  recoverAfterBotStart() {
    if (this.state.restart?.phase === 'countdown') {
      log.warn('Ein geplanter Neustart wurde verworfen, weil der Bot zwischendurch beendet wurde.');
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
    this.#say('Neustart abgebrochen.');
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
        log.info(`Serverprozess beendet (${formatDuration(now - restart.stopSentAt)} nach "stop").`);
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
        log.warn(`Server ist ${this.config.restartTimeoutMinutes} Min. nach dem Neustart nicht zurück.`);
        this.notify({
          text: `⚠️ **${name} ist ${this.config.restartTimeoutMinutes} Min. nach dem Neustart noch nicht wieder da.** `
            + `Bitte am Host-PC nachsehen – wurde der Server über \`${this.config.restartScriptName}\` gestartet?`,
          ping: true,
        });
      }
    } else if (restart.sawDown) {
      this.#end();
      this.state.lastRestartAt = now;
      log.info(`Neustart abgeschlossen nach ${formatDuration(now - restart.stopSentAt)}`);
      if (!restart.quiet) {
        this.notify({ text: `🟢 **${name} ist nach dem Neustart wieder online** (Dauer ${formatDuration(now - restart.stopSentAt)}).` });
      }
    } else if (now - restart.stopSentAt >= SHUTDOWN_TIMEOUT_MS) {
      this.#failStillRunning();
    }
  }

  /** Server hängt nach "stop": genau den gemerkten Prozess hart beenden. */
  async #killHungServer(restart, now) {
    const name = this.config.serverName;
    const minutes = Math.round((now - restart.stopSentAt) / 60000);
    const killed = await this.processes.killProcess(restart.serverProcess);
    if (killed) {
      restart.processGone = true;
      restart.sawDown = true;
      restart.killedAt = now;
      this.save();
      log.warn(`Serverprozess (PID ${restart.serverProcess.pid}) lief ${minutes} Min. nach "stop" noch – hart beendet.`);
      this.notify({
        text: `⚠️ **${name} hing nach dem Stoppen:** Der Serverprozess lief ${minutes} Min. nach \`stop\` noch und wurde beendet. `
          + `Die Welt war da bereits gespeichert; \`${this.config.restartScriptName}\` startet den Server jetzt neu.`,
      });
      return;
    }
    this.#end();
    log.error(`Serverprozess (PID ${restart.serverProcess.pid}) hängt nach "stop" und konnte nicht beendet werden.`);
    this.notify({
      text: `⚠️ **${name} hängt nach dem Stoppen und konnte nicht beendet werden.** `
        + 'Bitte am Host-PC den Java-Prozess des Servers beenden (evtl. läuft er mit Administratorrechten).',
      ping: true,
    });
  }

  #failStillRunning() {
    this.#end();
    log.warn('Neustart fehlgeschlagen: Der Server läuft nach "stop" immer noch.');
    this.notify({ text: '⚠️ **Neustart fehlgeschlagen:** Der Server läuft nach dem stop-Befehl immer noch.' });
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
    if (!serverProcess) log.warn('Serverprozess nicht gefunden – ohne Hänger-Absicherung weiter.');
    try {
      await this.monitor.rconExec('stop');
    } catch (err) {
      // Der Server trennt RCON beim Herunterfahren oft, bevor die Antwort kommt.
      log.warn(`Antwort auf "stop": ${err.message} – der Server fährt vermutlich trotzdem herunter.`);
    }
    // Keine offene RCON-Verbindung, solange der Server herunterfährt.
    this.monitor.pauseRcon?.(true);
    this.state.restart = { ...restart, phase: 'restarting', stopSentAt: Date.now(), sawDown: false, serverProcess };
    this.save();
    log.info(`"stop" gesendet${serverProcess ? ` (Serverprozess PID ${serverProcess.pid})` : ''} – warte, bis der Server neu gestartet ist.`);
    await this.refresh();
  }

  #say(text) {
    this.monitor.rconExec(tellraw(text)).catch((err) => log.warn(`Ankündigung im Spiel fehlgeschlagen: ${err.message}`));
  }

  #schedule(delayMs, fn) {
    const onError = (err) => log.error('Fehler im Neustart-Ablauf:', err);
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
