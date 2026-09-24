import net from 'node:net';

// Minimaler RCON-Client für den Vanilla-/NeoForge-Server.
//
// Eigenheiten des Vanilla-Servers, die hier berücksichtigt sind:
// - Er liest pro Socket-Read genau EIN Paket und trennt die Verbindung, wenn zwei
//   Pakete gleichzeitig ankommen. Deshalb wird immer nur ein Paket losgeschickt und
//   auf die Antwort gewartet, bevor das nächste folgt.
// - Lange Antworten (> 4096 Zeichen) werden auf mehrere Pakete verteilt. Um das Ende
//   zu erkennen, schicken wir nach dem ersten Antwortpaket ein Paket mit unbekanntem
//   Typ hinterher. Der Server beantwortet es erst, wenn die eigentliche Antwort
//   komplett raus ist.
const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
const TYPE_END_MARKER = 200;

export class RconError extends Error {}

export class RconClient {
  #socket = null;
  #buffer = Buffer.alloc(0);
  #handler = null;
  #authed = false;
  #nextId = 1;
  #queue = Promise.resolve();

  constructor({ host, port, password, timeoutMs = 8000 }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeoutMs = timeoutMs;
  }

  /** Führt einen Befehl aus und liefert die komplette Textantwort. Aufrufe werden nacheinander abgearbeitet. */
  exec(command) {
    const run = () => this.#exec(command);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => {});
    return result;
  }

  close() {
    this.#destroy(new RconError('RCON-Verbindung geschlossen'));
  }

  async #exec(command) {
    await this.#ensureConnected();
    const cmdId = this.#newId();
    const endId = this.#newId();
    const parts = [];
    let endSent = false;

    return this.#awaitPackets({
      start: () => this.#send(cmdId, TYPE_EXEC, command),
      packet: (pkt, resolve) => {
        if (pkt.id === cmdId) {
          parts.push(pkt.body);
          if (!endSent) {
            endSent = true;
            this.#send(endId, TYPE_END_MARKER, '');
          }
        } else if (pkt.id === endId) {
          resolve(parts.join(''));
        }
      },
    }, `RCON antwortet nicht auf "${command}" (Timeout)`);
  }

  async #ensureConnected() {
    if (this.#socket && this.#authed) return;
    this.#destroy();

    const socket = await new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new RconError(`Keine Verbindung zu RCON ${this.host}:${this.port} (Timeout)`));
      }, this.timeoutMs);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (err) => {
        clearTimeout(timer);
        reject(new RconError(`Keine Verbindung zu RCON ${this.host}:${this.port} (${err.code ?? err.message})`));
      });
    });

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('error', () => {}); // Wird über 'close' behandelt.
    socket.on('close', () => {
      if (this.#socket === socket) this.#destroy(new RconError('RCON-Verbindung wurde vom Server getrennt'));
    });
    this.#socket = socket;

    const authId = this.#newId();
    try {
      await this.#awaitPackets({
        start: () => this.#send(authId, TYPE_AUTH, this.password),
        packet: (pkt, resolve, reject) => {
          if (pkt.id === -1) reject(new RconError('RCON-Passwort ist falsch (RCON_PASSWORD mit rcon.password in der server.properties vergleichen)'));
          else if (pkt.id === authId) resolve();
        },
      }, 'RCON-Anmeldung: keine Antwort (Timeout)');
    } catch (err) {
      this.#destroy();
      throw err;
    }
    this.#authed = true;
  }

  #awaitPackets({ start, packet }, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.#handler = null;
      };
      const timer = setTimeout(() => {
        finish();
        reject(new RconError(timeoutMessage));
        this.#destroy();
      }, this.timeoutMs);

      this.#handler = {
        packet: (pkt) => packet(
          pkt,
          (value) => { finish(); resolve(value); },
          (err) => { finish(); reject(err); },
        ),
        fail: (err) => { finish(); reject(err); },
      };
      start();
    });
  }

  #send(id, type, body) {
    const payload = Buffer.from(body, 'utf8');
    const packet = Buffer.alloc(14 + payload.length); // endet mit zwei Null-Bytes
    packet.writeInt32LE(10 + payload.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    payload.copy(packet, 12);
    this.#socket.write(packet);
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readInt32LE(0);
      if (length < 10 || length > 1_048_576) {
        this.#destroy(new RconError('Ungültiges RCON-Paket empfangen'));
        return;
      }
      if (this.#buffer.length < 4 + length) return;
      const pkt = {
        id: this.#buffer.readInt32LE(4),
        type: this.#buffer.readInt32LE(8),
        body: this.#buffer.toString('utf8', 12, 4 + length - 2),
      };
      this.#buffer = this.#buffer.subarray(4 + length);
      this.#handler?.packet(pkt);
    }
  }

  #destroy(reason = new RconError('RCON-Verbindung geschlossen')) {
    const socket = this.#socket;
    this.#socket = null;
    this.#authed = false;
    this.#buffer = Buffer.alloc(0);
    const handler = this.#handler;
    this.#handler = null;
    socket?.destroy();
    handler?.fail(reason);
  }

  #newId() {
    const id = this.#nextId;
    this.#nextId = (this.#nextId % 0x7ffffffe) + 1;
    return id;
  }
}
