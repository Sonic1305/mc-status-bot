import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  escapeMarkdown,
} from 'discord.js';
import { buildStatusEmbed, discordTime } from './embed.js';
import { log } from './log.js';
import { countRestartScriptProcesses } from './restart.js';

// Alle Befehle hängen an einem Basisbefehl:
//   /mc status | hilfe                    – für alle
//   /mc server …                          – betrifft den Minecraft-Server
//   /mc bot …                             – betrifft den Discord-Bot
//
// Discord kann Sichtbarkeit nur pro Basisbefehl steuern. Weil /mc status für alle da ist,
// sieht jeder alle Unterbefehle – wer was ausführen darf, prüft der Bot selbst (ACCESS unten).

export const BASE_COMMAND = 'mc';
const CONFIRM_TIMEOUT_MS = 60_000;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const channelOption = (description) => (opt) => opt
  .setName('kanal').setDescription(description).addChannelTypes(...TEXT_CHANNELS).setRequired(true);

export const commandData = [
  new SlashCommandBuilder()
    .setName(BASE_COMMAND)
    .setDescription('Minecraft-Server und Status-Bot')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Aktueller Status des Minecraft-Servers (nur für dich sichtbar)'))
    .addSubcommand((sub) => sub
      .setName('hilfe')
      .setDescription('Zeigt die Befehle, die du nutzen darfst'))
    .addSubcommandGroup((group) => group
      .setName('server')
      .setDescription('Minecraft-Server steuern')
      .addSubcommand((sub) => sub
        .setName('neustart')
        .setDescription('Minecraft-Server neu starten, mit Countdown im Spiel (Bot-Besitzer)')
        .addIntegerOption((opt) => opt
          .setName('countdown')
          .setDescription('Vorwarnzeit für die Spieler (Standard: 1 Minute)')
          .addChoices(
            { name: 'sofort', value: 0 },
            { name: '1 Minute', value: 1 },
            { name: '5 Minuten', value: 5 },
            { name: '10 Minuten', value: 10 },
          )))
      .addSubcommand((sub) => sub
        .setName('neustart-abbrechen')
        .setDescription('Geplanten Neustart abbrechen (Bot-Besitzer)')))
    .addSubcommandGroup((group) => group
      .setName('bot')
      .setDescription('Status-Bot einrichten und verwalten')
      .addSubcommand((sub) => sub
        .setName('status-kanal')
        .setDescription('Live-Status-Nachricht in diesem Channel anlegen (Admins)')
        .addChannelOption(channelOption('Channel für die Live-Status-Nachricht')))
      .addSubcommand((sub) => sub
        .setName('meldungen')
        .setDescription('Meldungen (offline/online, Rekorde, Probleme) in einen Channel schicken (Admins)')
        .addChannelOption(channelOption('Channel für die Meldungen'))
        .addRoleOption((opt) => opt
          .setName('rolle')
          .setDescription('Rolle, die bei Offline/Online erwähnt wird (optional)')))
      .addSubcommand((sub) => sub
        .setName('meldungen-aus')
        .setDescription('Meldungen abschalten (Admins)'))
      .addSubcommand((sub) => sub
        .setName('rekorde-zuruecksetzen')
        .setDescription('Tages- und Allzeit-Spielerrekord zurücksetzen (Admins)'))
      .addSubcommand((sub) => sub
        .setName('info')
        .setDescription('Version, Einstellungen und Verbindungszustand des Bots (Admins)'))
      .addSubcommand((sub) => sub
        .setName('update')
        .setDescription('Nach einer neuen Bot-Version suchen und installieren (Bot-Besitzer)'))),
].map((command) => command.toJSON());

// Wer darf was: 'all' = alle, 'admin' = "Server verwalten" oder Bot-Besitzer, 'owner' = nur Bot-Besitzer
const ACCESS = {
  'status': 'all',
  'hilfe': 'all',
  'server neustart': 'owner',
  'server neustart-abbrechen': 'owner',
  'bot status-kanal': 'admin',
  'bot meldungen': 'admin',
  'bot meldungen-aus': 'admin',
  'bot rekorde-zuruecksetzen': 'admin',
  'bot info': 'admin',
  'bot update': 'owner',
};

const HELP = [
  ['status', 'all', 'Aktueller Serverstatus'],
  ['server neustart [countdown]', 'owner', 'Minecraft-Server neu starten'],
  ['server neustart-abbrechen', 'owner', 'Geplanten Neustart abbrechen'],
  ['bot status-kanal kanal:', 'admin', 'Live-Status-Nachricht anlegen'],
  ['bot meldungen kanal: [rolle:]', 'admin', 'Meldungen einschalten'],
  ['bot meldungen-aus', 'admin', 'Meldungen abschalten'],
  ['bot rekorde-zuruecksetzen', 'admin', 'Spielerrekorde zurücksetzen'],
  ['bot info', 'admin', 'Einstellungen und Zustand des Bots'],
  ['bot update', 'owner', 'Bot-Update sofort installieren'],
];

const cmd = (path) => `\`/${BASE_COMMAND} ${path}\``;

function mayUse(interaction, ctx, level) {
  if (level === 'all' || ctx.isOwner(interaction.user.id)) return true;
  return level === 'admin' && Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

const STATUS_CHANNEL_PERMS = [
  [PermissionFlagsBits.ViewChannel, 'Kanal ansehen'],
  [PermissionFlagsBits.SendMessages, 'Nachrichten senden'],
  [PermissionFlagsBits.EmbedLinks, 'Links einbetten'],
  [PermissionFlagsBits.ReadMessageHistory, 'Nachrichtenverlauf lesen'],
];
const ALERT_CHANNEL_PERMS = STATUS_CHANNEL_PERMS.slice(0, 2);

function missingPermissions(channel, member, required) {
  const perms = channel.permissionsFor(member);
  return required.filter(([flag]) => !perms?.has(flag)).map(([, label]) => label);
}

const STATUS_LABEL = {
  online: '🟢 online',
  degraded: '🟡 online (eingeschränkt)',
  offline: '🔴 offline',
  unknown: '⏳ noch keine Abfrage',
};

const displayName = (interaction) => interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
const ephemeral = { flags: MessageFlags.Ephemeral };

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

async function showStatus(interaction, ctx) {
  await interaction.reply({
    embeds: [buildStatusEmbed({ snapshot: ctx.getSnapshot(), state: ctx.state, config: ctx.config, nextRestart: ctx.getNextRestart() })],
    ...ephemeral,
  });
}

async function showHelp(interaction, ctx) {
  const lines = HELP
    .filter(([, level]) => mayUse(interaction, ctx, level))
    .map(([path, , text]) => `${cmd(path)} – ${text}`);
  await interaction.reply({ content: `**Befehle für dich:**\n${lines.join('\n')}`, ...ephemeral });
}

async function restartServer(interaction, ctx) {
  const minutes = interaction.options.getInteger('countdown') ?? 1;
  await interaction.deferReply(ephemeral);
  const blocked = ctx.restart.checkAllowed();
  if (blocked) {
    await interaction.editReply(`❌ ${blocked}`);
    return;
  }

  const snapshot = ctx.getSnapshot();
  const scriptName = ctx.config.restartScriptName;
  const scriptCount = await countRestartScriptProcesses(scriptName);
  const names = snapshot.players.map((p) => escapeMarkdown(p.name)).join(', ');
  const lines = [
    `**${ctx.config.serverName} neu starten?**`,
    `Countdown: **${minutes ? `${minutes} Min.` : 'sofort'}** · Online: **${snapshot.online}** Spieler${names ? ` (${names})` : ''}`,
  ];
  if (scriptCount === 0) {
    lines.push(`\n⚠️ Ich finde kein laufendes \`${scriptName}\`. Wurde der Server anders gestartet (z. B. über run.bat), bleibt er nach dem Herunterfahren **aus**.`);
  } else if (scriptCount === null) {
    lines.push(`\n⚠️ Konnte nicht prüfen, ob \`${scriptName}\` läuft. Falls nicht, bleibt der Server nach dem Herunterfahren aus.`);
  }

  const confirmId = `restart-confirm:${interaction.id}`;
  const cancelId = `restart-cancel:${interaction.id}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setStyle(ButtonStyle.Danger)
      .setLabel(scriptCount ? 'Neu starten' : 'Trotzdem neu starten'),
    new ButtonBuilder().setCustomId(cancelId).setStyle(ButtonStyle.Secondary).setLabel('Abbrechen'),
  );
  const message = await interaction.editReply({ content: lines.join('\n'), components: [row], allowedMentions: { parse: [] } });

  let click;
  try {
    click = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: CONFIRM_TIMEOUT_MS,
      filter: (i) => (i.customId === confirmId || i.customId === cancelId) && ctx.isOwner(i.user.id),
    });
  } catch {
    await interaction.editReply({ content: '⌛ Keine Bestätigung – kein Neustart.', components: [] });
    return;
  }
  if (click.customId !== confirmId) {
    await click.update({ content: 'Abgebrochen – kein Neustart.', components: [] });
    return;
  }

  const error = ctx.restart.start({ minutes, userId: click.user.id, userName: displayName(interaction) });
  await click.update({
    content: error
      ? `❌ ${error}`
      : minutes
        ? `✅ Neustart in ${minutes} Min. geplant – die Spieler werden im Spiel gewarnt. Abbrechen mit ${cmd('server neustart-abbrechen')}.`
        : '✅ Neustart läuft.',
    components: [],
  });
}

async function cancelRestart(interaction, ctx) {
  const error = ctx.restart.cancel({ userName: displayName(interaction) });
  await interaction.reply({ content: error ? `❌ ${error}` : '✅ Neustart abgebrochen.', ...ephemeral });
}

async function setStatusChannel(interaction, ctx, { guild, me }) {
  const channel = await guild.channels.fetch(interaction.options.getChannel('kanal', true).id);
  const missing = missingPermissions(channel, me, STATUS_CHANNEL_PERMS);
  if (missing.length) {
    await interaction.editReply(`❌ Mir fehlen in ${channel} diese Rechte: **${missing.join(', ')}**.`);
    return;
  }
  const error = await ctx.moveStatusMessage(channel.id);
  await interaction.editReply(error
    ? `⚠️ Channel gespeichert, aber die Nachricht konnte nicht gepostet werden: ${error}`
    : `✅ Die Live-Status-Nachricht steht jetzt in ${channel}.\n`
      + 'Tipp: Stell den Channel für alle anderen auf „nur lesen“, dann bleibt die Nachricht immer ganz unten sichtbar.');
}

async function setAlertChannel(interaction, ctx, { guild, me }) {
  const channel = await guild.channels.fetch(interaction.options.getChannel('kanal', true).id);
  const role = interaction.options.getRole('rolle');
  const missing = missingPermissions(channel, me, ALERT_CHANNEL_PERMS);
  if (missing.length) {
    await interaction.editReply(`❌ Mir fehlen in ${channel} diese Rechte: **${missing.join(', ')}**.`);
    return;
  }
  if (role && role.id === guild.id) {
    await interaction.editReply('❌ Bitte eine normale Rolle wählen, nicht @everyone.');
    return;
  }

  let hint = '';
  if (role && !role.mentionable && !channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) {
    hint = `\n⚠️ ${role} ist nicht erwähnbar, also würde niemand gepingt. In den Rollen-Einstellungen „Erlauben, dass jeder diese Rolle @erwähnen kann“ einschalten oder dem Bot das Recht „@everyone, @here und alle Rollen erwähnen“ geben.`;
  }

  ctx.state.alertChannelId = channel.id;
  ctx.state.alertRoleId = role?.id ?? null;
  ctx.save();
  await channel.send({
    content: `🔔 Status-Meldungen für **${ctx.config.serverName}** kommen ab jetzt hier an.`,
    allowedMentions: { parse: [] },
  });
  await interaction.editReply({
    content: `✅ Meldungen gehen jetzt an ${channel}${role ? `, bei Offline/Online wird ${role} erwähnt` : ''}.${hint}`,
    allowedMentions: { parse: [] },
  });
}

async function disableAlerts(interaction, ctx) {
  ctx.state.alertChannelId = null;
  ctx.state.alertRoleId = null;
  ctx.save();
  await interaction.editReply('🔕 Meldungen sind aus.');
}

async function resetRecords(interaction, ctx) {
  ctx.state.peakToday = { date: ctx.state.peakToday?.date ?? null, count: ctx.getSnapshot().online };
  ctx.state.record = { count: ctx.getSnapshot().online, at: Date.now() };
  ctx.save();
  await ctx.refreshStatus();
  await interaction.editReply('✅ Rekorde zurückgesetzt.');
}

async function showInfo(interaction, ctx) {
  const { config, state } = ctx;
  const snapshot = ctx.getSnapshot();
  const rconLine = !ctx.rconEnabled
    ? 'aus (kein RCON_PASSWORD) – nur Status-Ping'
    : ctx.getRconError() ? `❌ ${ctx.getRconError()}` : '✅ verbunden';
  const updateLine = !config.updateRepo
    ? 'kein Repository eingestellt'
    : `${config.autoUpdate ? `automatisch alle ${config.updateCheckHours} h` : 'aus (AUTO_UPDATE=false)'} · github.com/${config.updateRepo}`;
  const lines = [
    `**Version:** v${config.version} · **Updates:** ${updateLine}`,
    `**Status-Kanal:** ${state.statusChannelId ? `<#${state.statusChannelId}>` : `— noch nicht eingerichtet (${cmd('bot status-kanal')})`}`,
    `**Meldungen:** ${state.alertChannelId ? `<#${state.alertChannelId}>${state.alertRoleId ? ` mit <@&${state.alertRoleId}>` : ''}` : 'aus'}`,
    `**Server:** \`${config.mcHost}:${config.mcPort}\` · RCON-Port \`${config.rconPort}\``,
    `**RCON:** ${rconLine}`,
    `**Letzte Abfrage:** ${snapshot.checkedAt ? discordTime(snapshot.checkedAt) : '—'} → ${STATUS_LABEL[snapshot.status]}`,
    `**Takt:** Abfrage alle ${config.pollIntervalSec} s · Nachricht spätestens alle ${config.heartbeatSec} s neu`,
    `**Offline-Meldung:** ${config.offlineAlertMinutes ? `nach ${config.offlineAlertMinutes} Min. Ausfall` : 'sofort'}`,
    `**Bot-Besitzer:** ${ctx.ownerIds().length ? ctx.ownerIds().map((id) => `<@${id}>`).join(', ') : '— (noch nicht ermittelt)'} · Startskript \`${config.restartScriptName}\``,
    `**Geplante Neustarts:** ${config.restartSchedule.length
      ? `täglich ${config.restartSchedule.map((t) => t.label).join(', ')} (${config.restartScheduleCountdown} Min. Vorwarnung)`
        + (ctx.getNextRestart() ? ` · nächster ${discordTime(ctx.getNextRestart().at)}` : '')
      : 'aus (`RESTART_SCHEDULE`)'}`,
    `**Hänger-Absicherung:** ${config.restartKillAfterMinutes ? `Serverprozess wird ${config.restartKillAfterMinutes} Min. nach \`stop\` beendet, falls er hängt` : 'aus'}`,
  ];
  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

async function updateBot(interaction, ctx) {
  let result;
  try {
    result = await ctx.updater.checkAndInstall({ manual: true });
  } catch (err) {
    await interaction.editReply(`❌ Update fehlgeschlagen: ${err.message}`);
    return;
  }
  const current = ctx.config.version;
  const messages = {
    'disabled': result.latest
      ? `ℹ️ Bot-Version v${result.latest.version} ist verfügbar, aber Auto-Update ist auf dem Host-PC ausgeschaltet (\`AUTO_UPDATE=false\`).`
      : 'ℹ️ Kein Update-Repository eingestellt.',
    'none': 'ℹ️ Auf GitHub gibt es noch kein Release des Bots.',
    'up-to-date': `✅ Der Bot ist aktuell (v${current}).`,
    'busy': '⏳ Gerade läuft ein Server-Neustart oder eine Installation – bitte später erneut versuchen.',
    'installed': `⬆️ Bot-Version v${result.version} ist installiert (bisher v${current}) – der Bot startet jetzt neu.`,
  };
  await interaction.editReply(messages[result.status] ?? `Status: ${result.status}`);
  if (result.status === 'installed') ctx.onUpdateInstalled(result);
}

// Aktionen, die zuerst eine (nur für den Aufrufer sichtbare) Antwort vorbereiten
const DEFERRED = {
  'bot status-kanal': setStatusChannel,
  'bot meldungen': setAlertChannel,
  'bot meldungen-aus': disableAlerts,
  'bot rekorde-zuruecksetzen': resetRecords,
  'bot info': showInfo,
  'bot update': updateBot,
};
const DIRECT = {
  'status': showStatus,
  'hilfe': showHelp,
  'server neustart': restartServer,
  'server neustart-abbrechen': cancelRestart,
};

/**
 * ctx: { config, state, save, getSnapshot, getRconError, rconEnabled, moveStatusMessage, refreshStatus,
 *        isOwner, ownerIds, restart, updater, onUpdateInstalled, getNextRestart }
 */
export async function handleCommand(interaction, ctx) {
  if (interaction.commandName !== BASE_COMMAND) return;
  const group = interaction.options.getSubcommandGroup(false);
  const key = group ? `${group} ${interaction.options.getSubcommand()}` : interaction.options.getSubcommand();
  const level = ACCESS[key];
  if (!level) return;

  if (!mayUse(interaction, ctx, level)) {
    if (level === 'owner') {
      log.warn(`/${BASE_COMMAND} ${key} von ${interaction.user.tag} (${interaction.user.id}) abgelehnt – kein Bot-Besitzer.`);
    }
    await interaction.reply({
      content: level === 'owner'
        ? '⛔ Das darf nur der Bot-Besitzer.'
        : '⛔ Dafür brauchst du auf diesem Discord-Server das Recht „Server verwalten“.',
      ...ephemeral,
    });
    return;
  }

  if (DIRECT[key]) {
    await DIRECT[key](interaction, ctx);
    return;
  }
  await interaction.deferReply(ephemeral);
  const { guild } = interaction;
  const me = guild.members.me ?? await guild.members.fetchMe();
  await DEFERRED[key](interaction, ctx, { guild, me });
}
