import net from 'node:net';

function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/**
 * RCON-Server, der sich wie der Vanilla-Server verhält:
 * - pro Read wird genau ein Paket verarbeitet; stimmt die Länge nicht mit dem Read überein
 *   (z. B. zwei Pakete auf einmal), wird die Verbindung getrennt
 * - Antworten über 4096 Zeichen werden auf mehrere Pakete verteilt
 * - unbekannte Pakettypen werden mit "Unknown request <hex>" beantwortet
 */
export function startMockRcon({ password, commands }) {
  const stats = { connections: 0, droppedForCoalescing: 0, sockets: new Set() };
  const server = net.createServer((socket) => {
    stats.connections += 1;
    stats.sockets.add(socket);
    socket.on('close', () => stats.sockets.delete(socket));
    let authed = false;
    const send = (id, type, body) => {
      const payload = Buffer.from(body, 'utf8');
      const buf = Buffer.alloc(14 + payload.length);
      buf.writeInt32LE(10 + payload.length, 0);
      buf.writeInt32LE(id, 4);
      buf.writeInt32LE(type, 8);
      payload.copy(buf, 12);
      socket.write(buf);
    };
    const respond = (id, text) => {
      let rest = text;
      do {
        send(id, 0, rest.slice(0, 4096));
        rest = rest.slice(4096);
      } while (rest.length > 0);
    };
    socket.on('data', (chunk) => {
      const length = chunk.readInt32LE(0);
      if (length !== chunk.length - 4) {
        stats.droppedForCoalescing += 1;
        socket.destroy();
        return;
      }
      const id = chunk.readInt32LE(4);
      const type = chunk.readInt32LE(8);
      const body = chunk.toString('utf8', 12, chunk.length - 2);
      if (type === 3) {
        authed = body === password;
        send(authed ? id : -1, 2, '');
      } else if (type === 2) {
        if (!authed) send(-1, 2, '');
        else respond(id, commands[body] ?? 'Unknown or incomplete command, see below for error');
      } else {
        respond(id, `Unknown request ${type.toString(16)}`);
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, stats }));
  });
}

/** Status-Ping-Server, der eine feste JSON-Antwort liefert. */
export function startMockStatus(json) {
  const server = net.createServer((socket) => {
    let packets = 0;
    socket.on('data', (chunk) => {
      packets += 1; // Handshake + Status-Request (können zusammen ankommen)
      if (packets >= 1) {
        const body = Buffer.from(JSON.stringify(json), 'utf8');
        const payload = Buffer.concat([writeVarInt(0x00), writeVarInt(body.length), body]);
        socket.write(Buffer.concat([writeVarInt(payload.length), payload]));
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
