import { log } from './log.js';
import { countRestartScriptProcesses } from './restart.js';

// Geplante Neustarts (RESTART_SCHEDULE="04:00,16:00").
// Zur eingestellten Uhrzeit fährt der Server herunter; RESTART_SCHEDULE_COUNTDOWN_MINUTES
// vorher beginnt der Countdown im Spiel. Der Ablauf selbst ist derselbe wie bei /mc server restart,
// nur ohne Meldungen im Channel (außer wenn etwas schiefgeht).

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const CHECK_INTERVAL_MS = 20_000;
// War der Bot zur Startzeit kurz beschäftigt, wird bis 5 Min. danach noch nachgeholt – später nicht mehr.
const MISSED_GRACE_MS = 5 * 60 * 1000;
// Läuft der Server erst so kurz, ist ein Neustart sinnlos (z. B. gerade von Hand gestartet).
const MIN_UPTIME_MS = 30 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

/** "04:00, 16:30" -> [{ h, m, label }], sortiert und ohne Doppelte. Wirft bei ungültigen Zeiten. */
export function parseSchedule(text) {
  if (!text || !text.trim()) return [];
  const times = text.split(/[,;\s]+/).filter(Boolean).map((part) => {
    const match = TIME_RE.exec(part);
    if (!match) throw new Error(`"${part}" ist keine Uhrzeit im Format HH:MM`);
    const h = Number(match[1]);
    const m = Number(match[2]);
    return { h, m, label: `${pad(h)}:${pad(m)}` };
  });
  return [...new Map(times.map((t) => [t.label, t])).values()].sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));
}

function partsInZone(ms, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(format.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

function zoneOffsetMs(ms, timeZone) {
  const p = partsInZone(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Ortszeit in einer Zeitzone -> UTC-Millisekunden (berücksichtigt Sommer-/Winterzeit). */
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/** Nächster Termin nach afterMs: { at, label, key } oder null. */
export function nextSlot(schedule, timeZone, afterMs) {
  if (!schedule.length) return null;
  const today = partsInZone(afterMs, timeZone);
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    for (const time of schedule) {
      const at = zonedTimeToUtc(y, mo, d, time.h, time.m, timeZone);
      if (at > afterMs) return { at, label: time.label, key: `${y}-${pad(mo)}-${pad(d)} ${time.label}` };
    }
  }
  return null;
}

export class RestartScheduler {
  #timer = null;
  #upcoming = null;

  /**
   * @param deps.restartManager  RestartManager (checkAllowed, start)
   * @param deps.notify          (alert) => void – nur für Probleme
   * @param deps.countScript     Prüft, ob das Startskript läuft (für Tests austauschbar)
   */
  constructor({ config, state, save, restartManager, notify, countScript = countRestartScriptProcesses, now = () => Date.now() }) {
    this.config = config;
    this.state = state;
    this.save = save;
    this.restartManager = restartManager;
    this.notify = notify;
    this.countScript = countScript;
    this.now = now;
    this.schedule = config.restartSchedule ?? [];
  }

  get enabled() {
    return this.schedule.length > 0;
  }

  /** Nächster geplanter Neustart ({ at, label }) oder null. */
  get upcoming() {
    return this.#upcoming;
  }

  start() {
    if (!this.enabled) return;
    this.#upcoming = nextSlot(this.schedule, this.config.timezone, this.now());
    log.info(`Geplante Neustarts: täglich ${this.schedule.map((t) => t.label).join(', ')} (${this.config.timezone}), `
      + `${this.config.restartScheduleCountdown} Min. Vorwarnung.`);
    this.#timer = setInterval(() => {
      this.tick().catch((err) => log.error('Fehler beim geplanten Neustart:', err));
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.#timer);
  }

  async tick() {
    const slot = this.#upcoming;
    if (!slot) return;
    const now = this.now();
    const countdownMs = this.config.restartScheduleCountdown * 60 * 1000;
    if (now < slot.at - countdownMs) return;

    // Zuerst weiterschalten, damit derselbe Termin nie doppelt ausgelöst wird.
    this.#upcoming = nextSlot(this.schedule, this.config.timezone, slot.at);
    if (this.state.lastScheduledSlot === slot.key) return; // schon erledigt (z. B. vor einem Bot-Neustart)
    this.state.lastScheduledSlot = slot.key;
    this.save();

    if (now > slot.at + MISSED_GRACE_MS) {
      log.warn(`Geplanter Neustart ${slot.label} verpasst (Bot war nicht aktiv) – ausgelassen.`);
      return;
    }

    const skip = await this.#skipReason(now);
    if (skip) {
      log.warn(`Geplanter Neustart ${slot.label} ausgelassen: ${skip.text}`);
      if (skip.alert) this.notify({ text: `⚠️ **Geplanter Neustart ${slot.label} ausgelassen:** ${skip.text}` });
      return;
    }

    const minutes = Math.max(0, Math.min(this.config.restartScheduleCountdown, Math.round((slot.at - now) / 60000)));
    const error = this.restartManager.start({ minutes, userId: null, userName: `Zeitplan (${slot.label})`, quiet: true });
    if (error) log.warn(`Geplanter Neustart ${slot.label} nicht möglich: ${error}`);
    else log.info(`Geplanter Neustart ${slot.label}: Countdown läuft (${minutes} Min.).`);
  }

  async #skipReason(now) {
    const blocked = this.restartManager.checkAllowed(now);
    if (blocked) return { text: blocked };
    const since = this.state.onlineSince;
    if (since && now - since < MIN_UPTIME_MS) {
      return { text: `Der Server läuft erst seit ${Math.max(1, Math.round((now - since) / 60000))} Min.` };
    }
    const running = await this.countScript(this.config.restartScriptName);
    if (!running) {
      return {
        text: `\`${this.config.restartScriptName}\` läuft nicht – der Server wäre nach dem Herunterfahren aus geblieben. `
          + 'Den Server einmal über dieses Skript starten.',
        alert: true,
      };
    }
    return null;
  }
}
