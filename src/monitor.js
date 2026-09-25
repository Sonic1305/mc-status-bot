import { log } from './log.js';
import { pingServer } from './ping.js';
import { RconClient } from './rcon.js';

// Antwort von "list uuids", z. B.:
// There are 2 of a max of 16 players online: Steve (069a79f4-...), Alex (853c80ef-...)
const LIST_RE = /There are (\d+) of a max(?: of)? (\d+) players online:?\s*([\s\S]*)$/i;
const NAME_UUID_RE = /^(.+?)\s*\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

// Antwort von "neoforge tps" (letzte Zeile), z. B.: Overall: 19.874 TPS (50.317 ms/tick)
// Je nach Sprache von Windows/Java kann ein Komma statt Punkt kommen.
const TPS_RE = /Overall:\s*([\d.,]+)\s*TPS\s*\(([\d.,]+)\s*ms\/tick\)/i;

export function parseList(text) {
  const match = LIST_RE.exec(text.replace(/§./g, '').trim());
  if (!match) throw new Error(`Unerwartete Antwort auf "list uuids": ${text.slice(0, 200)}`);
  const rest = match[3].trim();
  const players = rest === ''
    ? []
    : rest.split(/,\s*/).filter(Boolean).map((entry) => {
      const nm = NAME_UUID_RE.exec(entry.trim());
      return nm ? { name: nm[1], uuid: nm[2] } : { name: entry.trim(), uuid: null };
    });
  return { online: Number(match[1]), max: Number(match[2]), players };
}

export function parseTps(text) {
  const match = TPS_RE.exec(text);
  if (!match) return null;
  const toNumber = (s) => Number(s.replace(',', '.'));
  const tps = toNumber(match[1]);
  const mspt = toNumber(match[2]);
  if (!Number.isFinite(tps) || !Number.isFinite(mspt)) return null;
  return { tps: Math.min(tps, 20), mspt };
}

export function emptySnapshot(status) {
  return {
    status, // 'unknown' | 'online' | 'degraded' | 'offline'
    online: 0,
    max: 0,
    players: [],
    namesComplete: true,
    tps: null,
    mspt: null,
    version: null,
    checkedAt: null,
    stale: false, // true = letzte Abfrage fehlgeschlagen, alter Stand wird noch gezeigt
  };
}

export class Monitor {
  #config;
  #rcon = null;
  #fails = 0;
  #rconError = null;
  #tpsWarned = false;
  #rconPaused = false;

  snapshot = emptySnapshot('unknown');

  constructor(config) {
    this.#config = config;
    if (config.rconPassword) {
      this.#rcon = new RconClient({
        host: config.mcHost,
        port: config.rconPort,
        password: config.rconPassword,
      });
    }
  }

  get rconEnabled() {
    return this.#rcon !== null;
  }

  get rconError() {
    return this.#rconError;
  }

  /** Fragt den Server ab und liefert den neuen Stand. */
  async poll() {
    const [rconResult, pingResult] = await Promise.allSettled([
      this.#queryRcon(),
      pingServer(this.#config.mcHost, this.#config.mcPort),
    ]);
    const now = Date.now();
    const prev = this.snapshot;
    const ping = pingResult.status === 'fulfilled' ? pingResult.value : null;

    let rcon = null;
    if (rconResult.status === 'fulfilled') {
      rcon = rconResult.value;
      if (rcon && this.#rconError) {
        log.info('RCON antwortet wieder.');
        this.#rconError = null;
      }
    } else {
      const message = rconResult.reason?.message ?? String(rconResult.reason);
      if (message !== this.#rconError) {
        log.warn(`RCON-Abfrage fehlgeschlagen: ${message}`);
        this.#rconError = message;
      }
    }

    if (rcon) {
      this.#fails = 0;
      this.snapshot = {
        status: 'online',
        online: rcon.online,
        max: rcon.max,
        players: rcon.players,
        namesComplete: true,
        tps: rcon.tps,
        mspt: rcon.mspt,
        version: ping?.version ?? prev.version,
        checkedAt: now,
      };
    } else if (ping) {
      // Server antwortet, aber RCON nicht (z. B. starker Lag oder falsches Passwort).
      this.#fails = 0;
      this.snapshot = {
        status: this.#rcon ? 'degraded' : 'online',
        online: ping.online,
        max: ping.max,
        players: ping.sample,
        namesComplete: ping.sample.length >= ping.online,
        tps: null,
        mspt: null,
        version: ping.version,
        checkedAt: now,
      };
    } else {
      // Einzelne Aussetzer (Lag-Spitze) werden toleriert, erst nach mehreren Fehlschlägen gilt der Server als offline.
      this.#fails += 1;
      const wasUp = prev.status === 'online' || prev.status === 'degraded';
      this.snapshot = wasUp && this.#fails < this.#config.offlineAfterFails
        ? { ...prev, stale: true, checkedAt: now }
        : { ...emptySnapshot('offline'), version: prev.version, checkedAt: now };
    }
    return this.snapshot;
  }

  /**
   * RCON während eines Neustarts ruhen lassen: Verbindung schließen und bis zum Aufheben nicht neu verbinden.
   * Offene RCON-Verbindungen können einen Server, der beim Herunterfahren hängt, zusätzlich am Leben halten.
   */
  pauseRcon(paused) {
    this.#rconPaused = paused;
    if (paused) this.#rcon?.close();
  }

  get rconPaused() {
    return this.#rconPaused;
  }

  /** Führt einen RCON-Befehl aus (für Neustart-Ankündigungen und "stop"). */
  rconExec(command) {
    if (!this.#rcon) return Promise.reject(new Error('RCON ist nicht eingerichtet'));
    return this.#rcon.exec(command);
  }

  close() {
    this.#rcon?.close();
  }

  async #queryRcon() {
    if (!this.#rcon || this.#rconPaused) return null;
    const list = parseList(await this.#rcon.exec('list uuids'));

    let tps = null;
    let mspt = null;
    if (this.#config.showTps) {
      try {
        const parsed = parseTps(await this.#rcon.exec('neoforge tps'));
        if (parsed) {
          ({ tps, mspt } = parsed);
        } else if (!this.#tpsWarned) {
          log.warn('"neoforge tps" liefert kein bekanntes Format – die TPS-Anzeige bleibt leer (SHOW_TPS=false schaltet sie ab).');
          this.#tpsWarned = true;
        }
      } catch {
        // TPS sind nur ein Zusatz; die Spielerliste zählt trotzdem.
      }
    }
    return { ...list, tps, mspt };
  }
}
