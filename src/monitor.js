import { t } from './i18n.js';
import { log } from './log.js';
import { pingServer } from './ping.js';
import { RconClient } from './rcon.js';

// Antwort von "list uuids", z. B.:
// There are 2 of a max of 16 players online: Steve (069a79f4-...), Alex (853c80ef-...)
const LIST_RE = /There are (\d+) of a max(?: of)? (\d+) players online:?\s*([\s\S]*)$/i;
const NAME_UUID_RE = /^(.+?)\s*\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

// TPS-Befehle der verschiedenen Server-Typen. Je nach Sprache von Windows/Java kann ein Komma statt Punkt kommen.
const toNumber = (s) => Number(s.replace(',', '.'));
export const TPS_SOURCES = {
  // NeoForge: "Overall: 19.874 TPS (50.317 ms/tick)"
  neoforge: {
    command: 'neoforge tps',
    parse: (text) => {
      const m = /Overall:\s*(\d+(?:[.,]\d+)?)\s*TPS\s*\((\d+(?:[.,]\d+)?)\s*ms\/tick\)/i.exec(text);
      return m && { tps: toNumber(m[1]), mspt: toNumber(m[2]) };
    },
  },
  // Forge bis 1.20: "Overall: Mean tick time: 0.845 ms. Mean TPS: 20.000"
  forge: {
    command: 'forge tps',
    parse: (text) => {
      const m = /Overall:\s*Mean tick time:\s*(\d+(?:[.,]\d+)?)\s*ms\.?\s*Mean TPS:\s*(\d+(?:[.,]\d+)?)/i.exec(text);
      return m && { tps: toNumber(m[2]), mspt: toNumber(m[1]) };
    },
  },
  // Paper/Spigot/Purpur: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0" (ohne ms/Tick)
  paper: {
    command: 'tps',
    parse: (text) => {
      const m = /TPS from last 1m, 5m, 15m:\s*\*?(\d+(?:[.,]\d+)?)/i.exec(text);
      return m && { tps: toNumber(m[1]), mspt: null };
    },
  },
  // Vanilla/Fabric ab 1.20.3: "Target tick rate: 20.0 per second. Average time per tick: 1.2ms (Target: 50.0ms)"
  vanilla: {
    command: 'tick query',
    parse: (text) => {
      const m = /Target tick rate:\s*(\d+(?:[.,]\d+)?)[\s\S]*?Average time per tick:\s*(\d+(?:[.,]\d+)?)\s*ms/i.exec(text);
      if (!m) return null;
      const rate = toNumber(m[1]);
      const mspt = toNumber(m[2]);
      return { tps: mspt > 0 ? Math.min(rate, 1000 / mspt) : rate, mspt };
    },
  },
};
const AUTO_ORDER = ['neoforge', 'forge', 'paper', 'vanilla'];

export function parseList(text) {
  const match = LIST_RE.exec(text.replace(/§./g, '').trim());
  if (!match) throw new Error(t('monitor.unexpectedList', { text: text.slice(0, 200) }));
  const rest = match[3].trim();
  const players = rest === ''
    ? []
    : rest.split(/,\s*/).filter(Boolean).map((entry) => {
      const nm = NAME_UUID_RE.exec(entry.trim());
      return nm ? { name: nm[1], uuid: nm[2] } : { name: entry.trim(), uuid: null };
    });
  return { online: Number(match[1]), max: Number(match[2]), players };
}

/** Liest TPS (und wenn vorhanden ms/Tick) aus der Antwort eines TPS-Befehls. kind = Server-Typ, sonst alle probieren. */
export function parseTps(text, kind = null) {
  const clean = String(text).replace(/§./g, '');
  for (const key of kind ? [kind] : AUTO_ORDER) {
    const parsed = TPS_SOURCES[key].parse(clean);
    if (parsed && Number.isFinite(parsed.tps) && (parsed.mspt === null || Number.isFinite(parsed.mspt))) {
      return { tps: Math.min(parsed.tps, 20), mspt: parsed.mspt };
    }
  }
  return null;
}

/** Wer ist seit der letzten Abfrage dazugekommen bzw. gegangen? Nur bei vollständigen Namenslisten, sonst null. */
export function playerChanges(prev, next) {
  const complete = (s) => s.status === 'online' && !s.stale && s.namesComplete;
  if (!complete(prev) || !complete(next)) return null;
  const before = new Set(prev.players.map((p) => p.name));
  const after = new Set(next.players.map((p) => p.name));
  const joined = [...after].filter((name) => !before.has(name));
  const left = [...before].filter((name) => !after.has(name));
  return joined.length || left.length ? { joined, left } : null;
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
    motd: null,
    checkedAt: null,
    stale: false, // true = letzte Abfrage fehlgeschlagen, alter Stand wird noch gezeigt
  };
}

export class Monitor {
  #config;
  #rcon = null;
  #fails = 0;
  #rconError = null;
  #tpsSource = null; // gefundener TPS-Befehl (Schlüssel in TPS_SOURCES), false = keiner funktioniert
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

  /** Genutzter TPS-Befehl, z. B. "neoforge tps"; null = noch keiner gefunden, false = keiner funktioniert. */
  get tpsCommand() {
    return this.#tpsSource ? TPS_SOURCES[this.#tpsSource].command : this.#tpsSource;
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
        log.info(t('log.rconBack'));
        this.#rconError = null;
      }
    } else {
      const message = rconResult.reason?.message ?? String(rconResult.reason);
      if (message !== this.#rconError) {
        log.warn(t('log.rconFailed', { error: message }));
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
        motd: ping?.motd ?? prev.motd,
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
        motd: ping.motd,
        checkedAt: now,
      };
    } else {
      // Einzelne Aussetzer (Lag-Spitze) werden toleriert, erst nach mehreren Fehlschlägen gilt der Server als offline.
      this.#fails += 1;
      const wasUp = prev.status === 'online' || prev.status === 'degraded';
      this.snapshot = wasUp && this.#fails < this.#config.offlineAfterFails
        ? { ...prev, stale: true, checkedAt: now }
        : { ...emptySnapshot('offline'), version: prev.version, motd: prev.motd, checkedAt: now };
      // Nach einem Ausfall läuft evtl. eine andere Server-Software: TPS-Befehl dann neu suchen.
      if (this.snapshot.status === 'offline' && this.#tpsSource === false) this.#tpsSource = null;
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
    if (!this.#rcon) return Promise.reject(new Error(t('monitor.noRcon')));
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
    if (this.#config.showTps && this.#tpsSource !== false) {
      try {
        ({ tps, mspt } = await this.#queryTps() ?? { tps: null, mspt: null });
      } catch {
        // TPS sind nur ein Zusatz; die Spielerliste zählt trotzdem.
      }
    }
    return { ...list, tps, mspt };
  }

  /** Fragt die TPS ab. Bei TPS_COMMAND=auto wird beim ersten Mal der passende Befehl gesucht. */
  async #queryTps() {
    if (this.#tpsSource) return parseTps(await this.#rcon.exec(TPS_SOURCES[this.#tpsSource].command), this.#tpsSource);
    const mode = this.#config.tpsCommand ?? 'auto';
    const candidates = mode === 'auto' ? AUTO_ORDER : [mode];
    for (const kind of candidates) {
      const parsed = parseTps(await this.#rcon.exec(TPS_SOURCES[kind].command), kind);
      if (parsed) {
        this.#tpsSource = kind;
        log.info(t('log.tpsSource', { command: TPS_SOURCES[kind].command }));
        return parsed;
      }
    }
    this.#tpsSource = false;
    log.warn(t('log.tpsUnavailable', { commands: candidates.map((k) => TPS_SOURCES[k].command).join(', ') }));
    return null;
  }
}
