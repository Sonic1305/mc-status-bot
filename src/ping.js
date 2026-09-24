import net from 'node:net';

// Server List Ping: dasselbe, was die Serverliste im Minecraft-Client macht.
// Funktioniert ohne RCON, liefert aber höchstens eine Stichprobe von ~12 Namen.
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

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

function readVarInt(buffer, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buffer.length) return null;
    const byte = buffer[pos++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new Error('Ungültige Status-Antwort (VarInt zu lang)');
  }
  return { value, size: pos - offset };
}

function writeString(text) {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([writeVarInt(bytes.length), bytes]);
}

function packet(id, ...fields) {
  const body = Buffer.concat([writeVarInt(id), ...fields]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function flattenText(component) {
  if (component == null) return '';
  if (typeof component === 'string') return component;
  if (Array.isArray(component)) return component.map(flattenText).join('');
  return (component.text ?? '') + (component.extra ?? []).map(flattenText).join('');
}

export function pingServer(host, port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const done = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(result);
    };
    const timer = setTimeout(() => done(new Error(`Status-Ping an ${host}:${port}: Timeout`)), timeoutMs);

    socket.on('error', (err) => done(new Error(`Status-Ping an ${host}:${port}: ${err.code ?? err.message}`)));
    socket.on('close', () => done(new Error(`Status-Ping an ${host}:${port}: Verbindung vorzeitig getrennt`)));

    socket.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      socket.write(packet(0x00, writeVarInt(-1), writeString(host), portBuf, writeVarInt(1)));
      socket.write(packet(0x00));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const length = readVarInt(buffer, 0);
        if (!length || buffer.length < length.size + length.value) return;
        let offset = length.size;
        const packetId = readVarInt(buffer, offset);
        offset += packetId.size;
        if (packetId.value !== 0x00) throw new Error(`Unerwartetes Paket 0x${packetId.value.toString(16)}`);
        const strLen = readVarInt(buffer, offset);
        offset += strLen.size;
        const json = JSON.parse(buffer.toString('utf8', offset, offset + strLen.value));

        const sample = (json.players?.sample ?? [])
          .filter((p) => p?.name && p.id !== EMPTY_UUID)
          .map((p) => ({ name: p.name.replace(/§./g, ''), uuid: p.id ?? null }));

        done(null, {
          online: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          sample,
          version: json.version?.name ?? null,
          motd: flattenText(json.description).replace(/§./g, '').trim(),
          latencyMs: Date.now() - started,
        });
      } catch (err) {
        done(new Error(`Status-Ping an ${host}:${port}: ${err.message}`));
      }
    });
  });
}
