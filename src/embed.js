import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { locale, t } from './i18n.js';

const COLORS = {
  online: 0x2ecc71,
  degraded: 0xf1c40f,
  offline: 0xe74c3c,
  unknown: 0x95a5a6,
  stopped: 0x4f545c,
  restarting: 0x3498db,
};
const DEFAULT_MAX_LISTED_PLAYERS = 40;
const TPS_EMOJI = { good: '🟢', ok: '🟡', bad: '🔴' };

// Anzeige-Schalter (SHOW_*): fehlt ein Wert, wird das Feld gezeigt.
const on = (flag) => flag !== false;

/** Discord-Zeitstempel: wird bei jedem Betrachter live in dessen Zeitzone angezeigt ("vor 2 Minuten"). */
export const discordTime = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function tpsBucket(tps) {
  if (tps == null) return null;
  if (tps >= 18) return 'good';
  if (tps >= 15) return 'ok';
  return 'bad';
}

function playerList(snapshot, config) {
  if (snapshot.online === 0) return t('embed.nobodyOnline');
  const names = snapshot.players
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, locale(), { sensitivity: 'base' }));
  const lines = names.slice(0, config.maxListedPlayers ?? DEFAULT_MAX_LISTED_PLAYERS).map((name) => `• ${escapeMarkdown(name)}`);
  const hidden = snapshot.online - lines.length;
  if (hidden > 0) lines.push(t('embed.morePlayers', { count: hidden }));
  return lines.join('\n');
}

function connectField(config) {
  const lines = [];
  if (config.vpnNetwork) lines.push(`${t('embed.connect.network')}: \`${config.vpnNetwork}\``);
  if (config.vpnPassword) lines.push(`${t('embed.connect.password')}: \`${config.vpnPassword}\``);
  if (config.connectAddress) lines.push(`${t('embed.connect.address')}: \`${config.connectAddress}\``);
  if (lines.length === 0) return null;
  return { name: t('embed.connect.title', { vpn: config.vpnName }), value: lines.join('\n'), inline: false };
}

function recordField(state) {
  const at = state.record?.at ? ` (${discordTime(state.record.at, 'd')})` : '';
  return {
    name: t('embed.records.title'),
    value: t('embed.records.value', { today: state.peakToday?.count ?? 0, allTime: state.record?.count ?? 0, at }),
    inline: true,
  };
}

function updatedField(config, now) {
  // Wenn der Host-PC hart ausgeht, kann der Bot nichts mehr ändern.
  // Diese Zeile verrät dann, dass die Anzeige veraltet ist.
  const staleMinutes = Math.ceil((config.heartbeatSec + config.pollIntervalSec) / 60) + 1;
  return { name: t('embed.updated.title'), value: t('embed.updated.value', { time: discordTime(now), minutes: staleMinutes }), inline: false };
}

/** Felder, die in jeder Ansicht unten stehen (Rekorde, "Aktualisiert"). */
function footerFields(state, config, now) {
  const fields = [];
  if (on(config.showRecords)) fields.push(recordField(state));
  if (on(config.showLastUpdated)) fields.push(updatedField(config, now));
  return fields;
}

/** nextRestart: nächster geplanter Neustart ({ at }) oder null */
export function buildStatusEmbed({ snapshot, state, config, now = Date.now(), nextRestart = null }) {
  const embed = new EmbedBuilder().setTimestamp(now);
  if (config.thumbnailUrl) embed.setThumbnail(config.thumbnailUrl);
  const name = config.serverName;
  const version = config.versionText || snapshot.version;
  const restart = state.restart;

  if (restart?.phase === 'restarting') {
    return embed
      .setColor(COLORS.restarting)
      .setTitle(t('embed.restarting.title', { name }))
      .setDescription(t('embed.restarting.description', { by: escapeMarkdown(restart.byName ?? '?'), time: discordTime(restart.stopSentAt ?? now) }))
      .addFields(footerFields(state, config, now));
  }

  if (snapshot.status === 'unknown') {
    return embed
      .setColor(COLORS.unknown)
      .setTitle(t('embed.unknown.title', { name }))
      .setDescription(t('embed.unknown.description'))
      .addFields(on(config.showLastUpdated) ? [updatedField(config, now)] : []);
  }

  if (snapshot.status === 'offline') {
    return embed
      .setColor(COLORS.offline)
      .setTitle(t('embed.offline.title', { name }))
      .setDescription(t('embed.offline.description', { since: state.offlineSince ? discordTime(state.offlineSince) : null }))
      .addFields(footerFields(state, config, now));
  }

  const degraded = snapshot.status === 'degraded';
  const parts = [];
  if (restart?.phase === 'countdown') {
    parts.push(t('embed.countdown', { time: discordTime(restart.stopAt), by: escapeMarkdown(restart.byName ?? '?') }));
  }
  if (config.showMotd && snapshot.motd) { // MOTD ist standardmäßig aus
    parts.push(snapshot.motd.split('\n').map((line) => `> ${escapeMarkdown(line.trim())}`).join('\n'));
  }
  const playerHeader = t('embed.players', { online: snapshot.online, max: snapshot.max });
  parts.push(on(config.showPlayerList) ? `${playerHeader}\n${playerList(snapshot, config)}` : playerHeader);
  if (degraded) parts.push(t('embed.degradedHint'));

  const fields = [];
  if (on(config.showTps) && snapshot.tps != null) {
    const mspt = snapshot.mspt != null ? t('embed.performance.mspt', { mspt: Math.round(snapshot.mspt) }) : '';
    fields.push({ name: t('embed.performance.title'), value: `${TPS_EMOJI[tpsBucket(snapshot.tps)]} **${snapshot.tps.toFixed(1)}** TPS${mspt}`, inline: true });
  }
  if (on(config.showUptime) && state.onlineSince) fields.push({ name: t('embed.onlineSince'), value: discordTime(state.onlineSince), inline: true });
  if (on(config.showVersion) && version) fields.push({ name: t('embed.version'), value: escapeMarkdown(version), inline: true });
  if (on(config.showRecords)) fields.push(recordField(state));
  if (on(config.showNextRestart) && nextRestart && config.restartSchedule?.length) {
    fields.push({
      name: t('embed.dailyRestart.title'),
      value: t('embed.dailyRestart.value', { times: config.restartSchedule.map((x) => x.label).join(', '), next: discordTime(nextRestart.at) }),
      inline: true,
    });
  }
  const connect = connectField(config);
  if (connect) fields.push(connect);
  if (config.infoText) fields.push({ name: t('embed.info'), value: config.infoText.slice(0, 1024), inline: false });
  if (on(config.showLastUpdated)) fields.push(updatedField(config, now));

  return embed
    .setColor(degraded ? COLORS.degraded : COLORS.online)
    .setTitle(t(degraded ? 'embed.degraded.title' : 'embed.online.title', { name }))
    .setDescription(parts.join('\n\n'))
    .addFields(fields);
}

export function buildStoppedEmbed({ config, now = Date.now() }) {
  const embed = new EmbedBuilder()
    .setTimestamp(now)
    .setColor(COLORS.stopped)
    .setTitle(t('embed.stopped.title', { name: config.serverName }))
    .setDescription(t('embed.stopped.description', { time: discordTime(now) }));
  if (config.thumbnailUrl) embed.setThumbnail(config.thumbnailUrl);
  return embed;
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
    on(config.showTps) ? tpsBucket(snapshot.tps) : null,
    snapshot.version,
    config.showMotd ? snapshot.motd : null,
    state.onlineSince,
    state.offlineSince,
    state.peakToday?.count,
    state.record?.count,
    state.restart?.phase ?? null,
    state.restart?.stopAt ?? null,
  ]);
}

export function presenceFor(snapshot, state = {}) {
  if (state.restart?.phase === 'restarting') return { status: 'idle', text: t('presence.restarting') };
  switch (snapshot.status) {
    case 'online':
      return { status: 'online', text: t('presence.online', { online: snapshot.online, max: snapshot.max }) };
    case 'degraded':
      return { status: 'idle', text: t('presence.degraded', { online: snapshot.online, max: snapshot.max }) };
    case 'offline':
      return { status: 'dnd', text: t('presence.offline') };
    default:
      return { status: 'idle', text: t('presence.unknown') };
  }
}
