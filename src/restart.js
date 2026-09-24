import { execFile } from 'node:child_process';
import { escapeMarkdown } from 'discord.js';
import { log } from './log.js';

// Ablauf eines Neustarts:
//   countdown  -> Spieler werden im Spiel gewarnt, danach schickt der Bot per RCON "stop"
//   restarting -> der Server fährt herunter; das Startskript (start-mit-neustart.bat)
//                 startet ihn neu; der Bot wartet, bis er wieder online ist
// Der Bot startet den Server nie selbst – er schickt nur "stop".

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
   * @param deps.monitor  { snapshot, rconEnabled, rconExec(cmd) }
   * @param deps.notify   (alert) => void – Meldung in den Meldungs-Channel
   * @param deps.refresh  () => Promise – Status-Nachricht sofort aktualisieren
   */
  constructor({ config, state, save, monitor, notify, refresh }) {
    this.config = config;
    this.state = state;
    this.save = save;
    this.monitor = monitor;
    this.notify = notify;
    this.refresh = refresh;
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

  /** Beim Start des Bots: Ein Countdown aus dem vorherigen Bot-Prozess ist verloren. */
  recoverAfterBotStart() {
    if (this.state.restart?.phase === 'countdown') {
      log.warn('Ein geplanter Neustart wurde verworfen, weil der Bot zwischendurch beendet wurde.');
      this.state.restart = null;
      this.save();
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
  onPoll(snapshot, now = Date.now()) {
    const restart = this.state.restart;
    if (restart?.phase !== 'restarting') return;
    const reachable = (snapshot.status === 'online' || snapshot.status === 'degraded') && !snapshot.stale;
    const name = this.config.serverName;

    if (!reachable) {
      restart.sawDown = true;
      if (now - restart.stopSentAt >= this.config.restartTimeoutMinutes * 60 * 1000) {
        this.state.restart = null;
        this.state.offlineAlert = 'sent'; // Beim Wiederkommen gibt es dann "wieder online".
        log.warn(`Server ist ${this.config.restartTimeoutMinutes} Min. nach dem Neustart nicht zurück.`);
        this.notify({
          text: `⚠️ **${name} ist ${this.config.restartTimeoutMinutes} Min. nach dem Neustart noch nicht wieder da.** `
            + `Bitte am Host-PC nachsehen – wurde der Server über \`${this.config.restartScriptName}\` gestartet?`,
          ping: true,
        });
      }
    } else if (restart.sawDown) {
      this.state.restart = null;
      this.state.lastRestartAt = now;
      log.info(`Neustart abgeschlossen nach ${formatDuration(now - restart.stopSentAt)}.`);
      if (!restart.quiet) {
        this.notify({ text: `🟢 **${name} ist nach dem Neustart wieder online** (Dauer ${formatDuration(now - restart.stopSentAt)}).` });
      }
    } else if (now - restart.stopSentAt >= SHUTDOWN_TIMEOUT_MS) {
      this.state.restart = null;
      log.warn('Neustart fehlgeschlagen: Der Server läuft nach "stop" immer noch.');
      this.notify({ text: '⚠️ **Neustart fehlgeschlagen:** Der Server läuft nach dem stop-Befehl immer noch.' });
    }
  }

  async #sendStop() {
    const restart = this.state.restart;
    if (restart?.phase !== 'countdown') return;
    this.#clearTimers();
    try {
      await this.monitor.rconExec('stop');
    } catch (err) {
      // Der Server trennt RCON beim Herunterfahren oft, bevor die Antwort kommt.
      log.warn(`Antwort auf "stop": ${err.message} – der Server fährt vermutlich trotzdem herunter.`);
    }
    this.state.restart = { ...restart, phase: 'restarting', stopSentAt: Date.now(), sawDown: false };
    this.save();
    log.info('"stop" gesendet – warte, bis der Server neu gestartet ist.');
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
