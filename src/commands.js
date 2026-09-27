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
import { getLanguage, t } from './i18n.js';
import { log } from './log.js';
import { countRestartScriptProcesses } from './restart.js';

// Alle Befehle hängen an einem Basisbefehl. Die Namen sind immer englisch,
// die Beschreibungen und Antworten in der Sprache des Bots (LANGUAGE):
//   /mc status | help                     – für alle
//   /mc server …                          – betrifft den Minecraft-Server
//   /mc bot …                             – betrifft den Discord-Bot
//
// Discord kann Sichtbarkeit nur pro Basisbefehl steuern. Weil /mc status für alle da ist,
// sieht jeder alle Unterbefehle – wer was ausführen darf, prüft der Bot selbst (ACCESS unten).

export const BASE_COMMAND = 'mc';
const CONFIRM_TIMEOUT_MS = 60_000;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const channelOption = (description) => (opt) => opt
  .setName('channel').setDescription(description).addChannelTypes(...TEXT_CHANNELS).setRequired(true);

/** Befehlsdefinition für Discord (Beschreibungen in der aktiven Sprache). */
export function buildCommandData() {
  return [
    new SlashCommandBuilder()
      .setName(BASE_COMMAND)
      .setDescription(t('cmd.desc.base'))
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((sub) => sub.setName('status').setDescription(t('cmd.desc.status')))
      .addSubcommand((sub) => sub.setName('help').setDescription(t('cmd.desc.help')))
      .addSubcommandGroup((group) => group
        .setName('server')
        .setDescription(t('cmd.desc.server'))
        .addSubcommand((sub) => sub
          .setName('restart')
          .setDescription(t('cmd.desc.restart'))
          .addIntegerOption((opt) => opt
            .setName('countdown')
            .setDescription(t('cmd.desc.countdown'))
            .addChoices(
              { name: t('cmd.choice.now'), value: 0 },
              ...[1, 5, 10].map((minutes) => ({ name: t('cmd.choice.minutes', { minutes }), value: minutes })),
            )))
        .addSubcommand((sub) => sub.setName('cancel-restart').setDescription(t('cmd.desc.cancelRestart'))))
      .addSubcommandGroup((group) => group
        .setName('bot')
        .setDescription(t('cmd.desc.bot'))
        .addSubcommand((sub) => sub
          .setName('status-channel')
          .setDescription(t('cmd.desc.statusChannel'))
          .addChannelOption(channelOption(t('cmd.desc.statusChannelOption'))))
        .addSubcommand((sub) => sub
          .setName('alerts')
          .setDescription(t('cmd.desc.alerts'))
          .addChannelOption(channelOption(t('cmd.desc.alertsChannelOption')))
          .addRoleOption((opt) => opt.setName('role').setDescription(t('cmd.desc.alertsRoleOption'))))
        .addSubcommand((sub) => sub.setName('alerts-off').setDescription(t('cmd.desc.alertsOff')))
        .addSubcommand((sub) => sub.setName('reset-records').setDescription(t('cmd.desc.resetRecords')))
        .addSubcommand((sub) => sub.setName('info').setDescription(t('cmd.desc.info')))
        .addSubcommand((sub) => sub.setName('update').setDescription(t('cmd.desc.update')))),
  ].map((command) => command.toJSON());
}

// Wer darf was: 'all' = alle, 'admin' = "Server verwalten", Admin-Rolle oder Bot-Besitzer, 'owner' = nur Bot-Besitzer
const ACCESS = {
  'status': 'all',
  'help': 'all',
  'server restart': 'owner',
  'server cancel-restart': 'owner',
  'bot status-channel': 'admin',
  'bot alerts': 'admin',
  'bot alerts-off': 'admin',
  'bot reset-records': 'admin',
  'bot info': 'admin',
  'bot update': 'owner',
};

const HELP = [
  ['status', 'status', 'all'],
  ['server restart [countdown]', 'restart', 'owner'],
  ['server cancel-restart', 'cancelRestart', 'owner'],
  ['bot status-channel channel:', 'statusChannel', 'admin'],
  ['bot alerts channel: [role:]', 'alerts', 'admin'],
  ['bot alerts-off', 'alertsOff', 'admin'],
  ['bot reset-records', 'resetRecords', 'admin'],
  ['bot info', 'info', 'admin'],
  ['bot update', 'update', 'owner'],
];

const cmd = (path) => `\`/${BASE_COMMAND} ${path}\``;

/** Rollen-IDs des Mitglieds (Gateway: GuildMember, sonst Rohdaten mit einem ID-Array). */
function memberRoleIds(member) {
  const roles = member?.roles;
  if (Array.isArray(roles)) return roles;
  return roles?.cache ? [...roles.cache.keys()] : [];
}

function mayUse(interaction, ctx, level) {
  if (level === 'all' || ctx.isOwner(interaction.user.id)) return true;
  if (level !== 'admin') return false;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const adminRoles = ctx.config.adminRoleIds ?? [];
  return adminRoles.length > 0 && memberRoleIds(interaction.member).some((id) => adminRoles.includes(id));
}

const STATUS_CHANNEL_PERMS = [
  [PermissionFlagsBits.ViewChannel, 'perm.viewChannel'],
  [PermissionFlagsBits.SendMessages, 'perm.sendMessages'],
  [PermissionFlagsBits.EmbedLinks, 'perm.embedLinks'],
  [PermissionFlagsBits.ReadMessageHistory, 'perm.readHistory'],
];
const ALERT_CHANNEL_PERMS = STATUS_CHANNEL_PERMS.slice(0, 2);

function missingPermissions(channel, member, required) {
  const perms = channel.permissionsFor(member);
  return required.filter(([flag]) => !perms?.has(flag)).map(([, key]) => t(key));
}

const displayName = (interaction) => interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
const ephemeral = { flags: MessageFlags.Ephemeral };
const yesNo = (value) => (value ? '✅' : '—');

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
  const restartOff = ctx.config.restartEnabled === false;
  const lines = HELP
    .filter(([path, , level]) => mayUse(interaction, ctx, level) && !(restartOff && path.startsWith('server ')))
    .map(([path, key]) => `${cmd(path)} – ${t(`cmd.help.${key}`)}`);
  await interaction.reply({ content: `${t('cmd.help.title')}\n${lines.join('\n')}`, ...ephemeral });
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
  const script = ctx.config.restartScriptName;
  const scriptCount = script ? await countRestartScriptProcesses(script) : undefined;
  const names = snapshot.players.map((p) => escapeMarkdown(p.name)).join(', ');
  const lines = [
    t('cmd.restart.question', { name: ctx.config.serverName }),
    t('cmd.restart.summary', { minutes, online: snapshot.online, names }),
  ];
  if (scriptCount === 0) lines.push(`\n${t('cmd.restart.scriptMissing', { script })}`);
  else if (scriptCount === null) lines.push(`\n${t('cmd.restart.scriptUnknown', { script })}`);

  const confirmId = `restart-confirm:${interaction.id}`;
  const cancelId = `restart-cancel:${interaction.id}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setStyle(ButtonStyle.Danger)
      .setLabel(t(scriptCount === 0 || scriptCount === null ? 'cmd.restart.confirmAnyway' : 'cmd.restart.confirm')),
    new ButtonBuilder().setCustomId(cancelId).setStyle(ButtonStyle.Secondary).setLabel(t('cmd.restart.abort')),
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
    await interaction.editReply({ content: t('cmd.restart.noConfirmation'), components: [] });
    return;
  }
  if (click.customId !== confirmId) {
    await click.update({ content: t('cmd.restart.aborted'), components: [] });
    return;
  }

  const error = ctx.restart.start({ minutes, userId: click.user.id, userName: displayName(interaction) });
  await click.update({
    content: error ? `❌ ${error}` : t('cmd.restart.started', { minutes, cancel: cmd('server cancel-restart') }),
    components: [],
  });
}

async function cancelRestart(interaction, ctx) {
  const error = ctx.restart.cancel({ userName: displayName(interaction) });
  await interaction.reply({ content: error ? `❌ ${error}` : t('cmd.cancelRestart.done'), ...ephemeral });
}

async function setStatusChannel(interaction, ctx, { guild, me }) {
  const channel = await guild.channels.fetch(interaction.options.getChannel('channel', true).id);
  const missing = missingPermissions(channel, me, STATUS_CHANNEL_PERMS);
  if (missing.length) {
    await interaction.editReply(t('cmd.missingPermissions', { channel: `${channel}`, permissions: missing.join(', ') }));
    return;
  }
  const error = await ctx.moveStatusMessage(channel.id);
  await interaction.editReply(error
    ? t('cmd.statusChannel.postFailed', { error })
    : t('cmd.statusChannel.done', { channel: `${channel}` }));
}

async function setAlertChannel(interaction, ctx, { guild, me }) {
  const channel = await guild.channels.fetch(interaction.options.getChannel('channel', true).id);
  const role = interaction.options.getRole('role');
  const missing = missingPermissions(channel, me, ALERT_CHANNEL_PERMS);
  if (missing.length) {
    await interaction.editReply(t('cmd.missingPermissions', { channel: `${channel}`, permissions: missing.join(', ') }));
    return;
  }
  if (role && role.id === guild.id) {
    await interaction.editReply(t('cmd.alerts.noEveryone'));
    return;
  }

  let hint = '';
  if (role && !role.mentionable && !channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) {
    hint = `\n${t('cmd.alerts.roleNotMentionable', { role: `${role}` })}`;
  }

  ctx.state.alertChannelId = channel.id;
  ctx.state.alertRoleId = role?.id ?? null;
  ctx.save();
  await channel.send({ content: t('cmd.alerts.channelGreeting', { name: ctx.config.serverName }), allowedMentions: { parse: [] } });
  await interaction.editReply({
    content: t('cmd.alerts.done', { channel: `${channel}`, role: role ? `${role}` : null }) + hint,
    allowedMentions: { parse: [] },
  });
}

async function disableAlerts(interaction, ctx) {
  ctx.state.alertChannelId = null;
  ctx.state.alertRoleId = null;
  ctx.save();
  await interaction.editReply(t('cmd.alertsOff.done'));
}

async function resetRecords(interaction, ctx) {
  ctx.state.peakToday = { date: ctx.state.peakToday?.date ?? null, count: ctx.getSnapshot().online };
  ctx.state.record = { count: ctx.getSnapshot().online, at: Date.now() };
  ctx.save();
  await ctx.refreshStatus();
  await interaction.editReply(t('cmd.resetRecords.done'));
}

async function showInfo(interaction, ctx) {
  const { config, state } = ctx;
  const snapshot = ctx.getSnapshot();
  const rconError = ctx.getRconError?.();
  const tpsCommand = ctx.getTpsCommand?.();
  const alertTypes = [
    ['offline', config.alertOffline !== false], ['records', config.alertRecords !== false],
    ['restarts', config.alertRestarts !== false], ['updates', config.alertBotUpdates !== false],
    ['joinLeave', config.alertJoinLeave === true],
  ].filter(([, enabled]) => enabled).map(([key]) => t(`info.alertType.${key}`));
  const nextRestart = ctx.getNextRestart();

  const lines = [
    t('info.version', {
      version: config.version,
      updates: !config.updateRepo ? t('info.updates.noRepo')
        : config.autoUpdate ? t('info.updates.auto', { hours: config.updateCheckHours, repo: config.updateRepo })
          : t('info.updates.off', { repo: config.updateRepo }),
    }),
    t('info.language', { language: t(`language.${getLanguage()}`), source: config.languageSource }),
    t('info.statusChannel', { channel: state.statusChannelId ? `<#${state.statusChannelId}>` : null, command: cmd('bot status-channel') }),
    t('info.alerts', {
      channel: state.alertChannelId ? `<#${state.alertChannelId}>` : null,
      role: state.alertRoleId ? `<@&${state.alertRoleId}>` : null,
      types: alertTypes.join(', '),
      offlineMinutes: config.offlineAlertMinutes,
    }),
    t('info.server', { host: config.mcHost, port: config.mcPort, rconPort: config.rconPort }),
    t('info.rcon', { enabled: ctx.rconEnabled, error: rconError }),
    t('info.tps', { show: config.showTps !== false, command: tpsCommand, mode: config.tpsCommand ?? 'auto' }),
    t('info.lastPoll', { time: snapshot.checkedAt ? discordTime(snapshot.checkedAt) : null, status: t(`info.status.${snapshot.status}`) }),
    t('info.timing', { poll: config.pollIntervalSec, heartbeat: config.heartbeatSec }),
    t('info.access', {
      owners: ctx.ownerIds().map((id) => `<@${id}>`).join(', '),
      roles: (config.adminRoleIds ?? []).map((id) => `<@&${id}>`).join(', '),
    }),
    t('info.restarts', { enabled: config.restartEnabled !== false, script: config.restartScriptName }),
  ];
  if (config.restartEnabled !== false) {
    lines.push(
      t('info.schedule', {
        times: config.restartSchedule.map((x) => x.label).join(', '),
        countdown: config.restartScheduleCountdown,
        next: nextRestart ? discordTime(nextRestart.at) : null,
      }),
      t('info.hangProtection', { minutes: config.restartKillAfterMinutes }),
    );
  }
  lines.push(t('info.display', {
    items: [
      ['showPlayerList', 'players'], ['showTps', 'tps'], ['showUptime', 'uptime'], ['showVersion', 'version'],
      ['showRecords', 'records'], ['showNextRestart', 'nextRestart'], ['showMotd', 'motd'], ['showPresence', 'presence'],
    ].map(([key, label]) => `${yesNo(key === 'showMotd' ? config[key] : config[key] !== false)} ${t(`info.display.${label}`)}`).join(' · '),
  }));
  await interaction.editReply({ content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
}

async function updateBot(interaction, ctx) {
  let result;
  try {
    result = await ctx.updater.checkAndInstall({ manual: true });
  } catch (err) {
    await interaction.editReply(t('cmd.update.failed', { error: err.message }));
    return;
  }
  const current = ctx.config.version;
  const messages = {
    'disabled': result.latest ? t('cmd.update.disabled', { version: result.latest.version }) : t('cmd.update.noRepo'),
    'none': t('cmd.update.noRelease'),
    'up-to-date': t('cmd.update.upToDate', { version: current }),
    'busy': t('cmd.update.busy'),
    'installed': t('cmd.update.installed', { version: result.version, current }),
  };
  await interaction.editReply(messages[result.status] ?? `Status: ${result.status}`);
  if (result.status === 'installed') ctx.onUpdateInstalled(result);
}

// Aktionen, die zuerst eine (nur für den Aufrufer sichtbare) Antwort vorbereiten
const DEFERRED = {
  'bot status-channel': setStatusChannel,
  'bot alerts': setAlertChannel,
  'bot alerts-off': disableAlerts,
  'bot reset-records': resetRecords,
  'bot info': showInfo,
  'bot update': updateBot,
};
const DIRECT = {
  'status': showStatus,
  'help': showHelp,
  'server restart': restartServer,
  'server cancel-restart': cancelRestart,
};

/**
 * ctx: { config, state, save, getSnapshot, getRconError, getTpsCommand, rconEnabled, moveStatusMessage, refreshStatus,
 *        isOwner, ownerIds, restart, updater, onUpdateInstalled, getNextRestart }
 */
export async function handleCommand(interaction, ctx) {
  if (interaction.commandName !== BASE_COMMAND) return;
  const group = interaction.options.getSubcommandGroup(false);
  const key = group ? `${group} ${interaction.options.getSubcommand()}` : interaction.options.getSubcommand();
  const level = ACCESS[key];
  if (!level) return;

  if (!mayUse(interaction, ctx, level)) {
    if (level === 'owner') log.warn(t('log.commandDenied', { command: `/${BASE_COMMAND} ${key}`, user: interaction.user.tag, id: interaction.user.id }));
    await interaction.reply({ content: t(level === 'owner' ? 'cmd.denied.owner' : 'cmd.denied.admin'), ...ephemeral });
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
