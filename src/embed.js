import { EmbedBuilder, escapeMarkdown } from 'discord.js';

const COLORS = {
  online: 0x2ecc71,
  degraded: 0xf1c40f,
  offline: 0xe74c3c,
  unknown: 0x95a5a6,
  stopped: 0x4f545c,
  restarting: 0x3498db,
};
const MAX_LISTED_PLAYERS = 40;
const TPS_EMOJI = { good: '🟢', ok: '🟡', bad: '🔴' };

/** Discord-Zeitstempel: wird bei jedem Betrachter live in dessen Zeitzone angezeigt ("vor 2 Minuten"). */
export const discordTime = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function tpsBucket(tps) {
  if (tps == null) return null;
  if (tps >= 18) return 'good';
  if (tps >= 15) return 'ok';
  return 'bad';
}

function playerList(snapshot) {
  if (snapshot.online === 0) return '_Gerade ist niemand online._';
  const names = snapshot.players
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  const lines = names.slice(0, MAX_LISTED_PLAYERS).map((name) => `• ${escapeMarkdown(name)}`);
  const hidden = snapshot.online - lines.length;
  if (hidden > 0) lines.push(`_… und ${hidden} weitere_`);
  return lines.join('\n');
}

function connectField(config) {
  const lines = [];
  if (config.radminNetwork) lines.push(`Radmin-Netzwerk: \`${config.radminNetwork}\``);
  if (config.radminPassword) lines.push(`Passwort: \`${config.radminPassword}\``);
  if (config.connectAddress) lines.push(`Adresse: \`${config.connectAddress}\``);
  if (lines.length === 0) return null;
  const name = config.radminNetwork || config.radminPassword ? '🔗 Verbinden (Radmin VPN)' : '🔗 Verbinden';
  return { name, value: lines.join('\n'), inline: false };
}

function recordField(state) {
  const record = state.record?.count ?? 0;
  const at = state.record?.at ? ` (${discordTime(state.record.at, 'd')})` : '';
  return { name: '📈 Rekorde', value: `Heute: **${state.peakToday?.count ?? 0}** · Allzeit: **${record}**${at}`, inline: true };
}

function updatedField(config, now) {
  // Wenn der Host-PC hart ausgeht, kann der Bot nichts mehr ändern.
  // Diese Zeile verrät dann, dass die Anzeige veraltet ist.
  const staleMinutes = Math.ceil((config.heartbeatSec + config.pollIntervalSec) / 60) + 1;
  return {
    name: '🔄 Aktualisiert',
    value: `${discordTime(now)}\n_Länger als ${staleMinutes} Min. her? Dann sind Host-PC oder Bot aus._`,
    inline: false,
  };
}

export function buildStatusEmbed({ snapshot, state, config, now = Date.now() }) {
  const embed = new EmbedBuilder().setTimestamp(now);
  const name = config.serverName;
  const version = config.versionText || snapshot.version;
  const restart = state.restart;

  if (restart?.phase === 'restarting') {
    return embed
      .setColor(COLORS.restarting)
      .setTitle(`🔄 ${name} startet neu`)
      .setDescription(
        `Neustart ausgelöst von **${escapeMarkdown(restart.byName ?? '?')}** ${discordTime(restart.stopSentAt ?? now)}.\n`
        + 'Der Server ist in ein paar Minuten wieder da.',
      )
      .addFields(recordField(state), updatedField(config, now));
  }

  if (snapshot.status === 'unknown') {
    return embed
      .setColor(COLORS.unknown)
      .setTitle(`⏳ ${name} – Status wird abgefragt …`)
      .setDescription('Der Bot ist gerade gestartet und fragt den Server ab.')
      .addFields(updatedField(config, now));
  }

  if (snapshot.status === 'offline') {
    const since = state.offlineSince ? `\nOffline seit ${discordTime(state.offlineSince)}.` : '';
    return embed
      .setColor(COLORS.offline)
      .setTitle(`🔴 ${name} ist offline`)
      .setDescription(`Der Server ist gerade nicht erreichbar.${since}`)
      .addFields(recordField(state), updatedField(config, now));
  }

  const degraded = snapshot.status === 'degraded';
  let description = `**👥 Spieler: ${snapshot.online} / ${snapshot.max}**\n${playerList(snapshot)}`;
  if (restart?.phase === 'countdown') {
    description = `🔄 **Neustart ${discordTime(restart.stopAt)}** (geplant von ${escapeMarkdown(restart.byName ?? '?')})\n\n${description}`;
  }
  if (degraded) {
    description += '\n\n⚠️ _RCON antwortet gerade nicht (starker Lag oder falsches RCON-Passwort). Die Namensliste ist evtl. unvollständig._';
  }

  const fields = [];
  if (config.showTps && snapshot.tps != null) {
    const mspt = snapshot.mspt != null ? ` · ${Math.round(snapshot.mspt)} ms/Tick` : '';
    fields.push({ name: '⚡ Leistung', value: `${TPS_EMOJI[tpsBucket(snapshot.tps)]} **${snapshot.tps.toFixed(1)}** TPS${mspt}`, inline: true });
  }
  if (state.onlineSince) fields.push({ name: '⏱️ Online seit', value: discordTime(state.onlineSince), inline: true });
  if (version) fields.push({ name: '📦 Version', value: escapeMarkdown(version), inline: true });
  fields.push(recordField(state));
  const connect = connectField(config);
  if (connect) fields.push(connect);
  fields.push(updatedField(config, now));

  return embed
    .setColor(degraded ? COLORS.degraded : COLORS.online)
    .setTitle(degraded ? `🟡 ${name} ist online (eingeschränkt)` : `🟢 ${name} ist online`)
    .setDescription(description)
    .addFields(fields);
}

export function buildStoppedEmbed({ config, now = Date.now() }) {
  return new EmbedBuilder()
    .setTimestamp(now)
    .setColor(COLORS.stopped)
    .setTitle(`⚫ ${config.serverName} – Status unbekannt`)
    .setDescription(
      `Der Status-Bot wurde ${discordTime(now)} beendet (Host-PC aus oder Bot gestoppt).\n`
      + 'Sobald der Bot wieder läuft, geht die Live-Anzeige weiter.',
    );
}

/**
 * Fingerabdruck von allem, was eine sofortige Aktualisierung rechtfertigt.
 * TPS zählen nur, wenn sie die Farbstufe wechseln – sonst würde jede Abfrage editieren.
 */
export function statusSignature(snapshot, state, config) {
  return JSON.stringify([
    snapshot.status,
    snapshot.online,
    snapshot.max,
    snapshot.players.map((p) => p.name).sort(),
    snapshot.namesComplete,
    config.showTps ? tpsBucket(snapshot.tps) : null,
    snapshot.version,
    state.onlineSince,
    state.offlineSince,
    state.peakToday?.count,
    state.record?.count,
    state.restart?.phase ?? null,
    state.restart?.stopAt ?? null,
  ]);
}

export function presenceFor(snapshot, state = {}) {
  if (state.restart?.phase === 'restarting') return { status: 'idle', text: '🔄 Neustart läuft' };
  switch (snapshot.status) {
    case 'online':
      return { status: 'online', text: `🟢 ${snapshot.online}/${snapshot.max} Spieler online` };
    case 'degraded':
      return { status: 'idle', text: `🟡 ${snapshot.online}/${snapshot.max} Spieler online` };
    case 'offline':
      return { status: 'dnd', text: '🔴 Server offline' };
    default:
      return { status: 'idle', text: '⏳ Status wird abgefragt …' };
  }
}
