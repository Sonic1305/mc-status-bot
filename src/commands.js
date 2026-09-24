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

const CONFIRM_TIMEOUT_MS = 60_000;

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const commandData = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Zeigt den aktuellen Status des Minecraft-Servers (nur für dich sichtbar).')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('statusbot')
    .setDescription('Status-Bot einrichten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Legt die Live-Status-Nachricht in einem Channel an (eine alte wird entfernt).')
      .addChannelOption((opt) => opt
        .setName('kanal')
        .setDescription('Channel für die Live-Status-Nachricht')
        .addChannelTypes(...TEXT_CHANNELS)
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('alarm')
      .setDescription('Meldungen bei Offline/Online und neuem Spielerrekord in einen Channel schicken.')
      .addChannelOption((opt) => opt
        .setName('kanal')
        .setDescription('Channel für die Meldungen')
        .addChannelTypes(...TEXT_CHANNELS)
        .setRequired(true))
      .addRoleOption((opt) => opt
        .setName('rolle')
        .setDescription('Rolle, die bei Offline/Online erwähnt wird (optional)')))
    .addSubcommand((sub) => sub
      .setName('alarm-aus')
      .setDescription('Schaltet die Meldungen ab.'))
    .addSubcommand((sub) => sub
      .setName('rekorde-zuruecksetzen')
      .setDescription('Setzt Tages- und Allzeit-Rekord auf 0 zurück.'))
    .addSubcommand((sub) => sub
      .setName('info')
      .setDescription('Zeigt Einstellungen und Verbindungszustand des Bots.')),

  // Sichtbar nur für Admins; ausführen darf ihn trotzdem nur der Bot-Besitzer (Prüfung im Code).
  new SlashCommandBuilder()
    .setName('server')
    .setDescription('Minecraft-Server steuern (nur Bot-Besitzer)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName('neustart')
      .setDescription('Startet den Minecraft-Server neu – mit Countdown im Spiel.')
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
      .setDescription('Bricht einen geplanten Neustart ab.'))
    .addSubcommand((sub) => sub
      .setName('update')
      .setDescription('Prüft auf eine neue Version des Status-Bots und installiert sie.')),
].map((command) => command.toJSON());

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

async function handleServerCommand(interaction, ctx) {
  // Die eigentliche Sicherheitsprüfung: nur die hinterlegte User-ID des Bot-Besitzers.
  // Discord-Rollen oder -Rechte spielen hier bewusst keine Rolle.
  if (!ctx.isOwner(interaction.user.id)) {
    log.warn(`/server ${interaction.options.getSubcommand()} von ${interaction.user.tag} (${interaction.user.id}) abgelehnt – kein Bot-Besitzer.`);
    await interaction.reply({ content: '⛔ Nur der Bot-Besitzer darf den Server steuern.', flags: MessageFlags.Ephemeral });
    return;
  }
  const userName = displayName(interaction);

  if (interaction.options.getSubcommand() === 'update') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
        ? `ℹ️ v${result.latest.version} ist verfügbar, aber Auto-Update ist auf dem Host-PC ausgeschaltet (\`AUTO_UPDATE=false\`).`
        : 'ℹ️ Kein Update-Repository eingestellt.',
      'none': 'ℹ️ Auf GitHub gibt es noch kein Release.',
      'up-to-date': `✅ v${current} ist die neueste Version.`,
      'busy': '⏳ Gerade läuft ein Server-Neustart oder eine Installation – bitte später erneut versuchen.',
      'installed': `⬆️ v${result.version} ist installiert (bisher v${current}) – der Bot startet jetzt neu.`,
    };
    await interaction.editReply(messages[result.status] ?? `Status: ${result.status}`);
    if (result.status === 'installed') ctx.onUpdateInstalled(result);
    return;
  }

  if (interaction.options.getSubcommand() === 'neustart-abbrechen') {
    const error = ctx.restart.cancel({ userName });
    await interaction.reply({ content: error ? `❌ ${error}` : '✅ Neustart abgebrochen.', flags: MessageFlags.Ephemeral });
    return;
  }

  const minutes = interaction.options.getInteger('countdown') ?? 1;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

  const error = ctx.restart.start({ minutes, userId: click.user.id, userName });
  await click.update({
    content: error
      ? `❌ ${error}`
      : minutes
        ? `✅ Neustart in ${minutes} Min. geplant – die Spieler werden im Spiel gewarnt. Abbrechen mit \`/server neustart-abbrechen\`.`
        : '✅ Neustart läuft.',
    components: [],
  });
}

/**
 * ctx: { config, state, save, getSnapshot, getRconError, rconEnabled, moveStatusMessage, refreshStatus,
 *        isOwner, ownerIds, restart }
 */
export async function handleCommand(interaction, ctx) {
  if (interaction.commandName === 'server') {
    await handleServerCommand(interaction, ctx);
    return;
  }

  if (interaction.commandName === 'status') {
    await interaction.reply({
      embeds: [buildStatusEmbed({ snapshot: ctx.getSnapshot(), state: ctx.state, config: ctx.config, nextRestart: ctx.getNextRestart() })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.commandName !== 'statusbot') return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild } = interaction;
  const me = guild.members.me ?? await guild.members.fetchMe();
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
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
    return;
  }

  if (sub === 'alarm') {
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
    return;
  }

  if (sub === 'alarm-aus') {
    ctx.state.alertChannelId = null;
    ctx.state.alertRoleId = null;
    ctx.save();
    await interaction.editReply('🔕 Meldungen sind aus.');
    return;
  }

  if (sub === 'rekorde-zuruecksetzen') {
    ctx.state.peakToday = { date: ctx.state.peakToday?.date ?? null, count: ctx.getSnapshot().online };
    ctx.state.record = { count: ctx.getSnapshot().online, at: Date.now() };
    ctx.save();
    await ctx.refreshStatus();
    await interaction.editReply('✅ Rekorde zurückgesetzt.');
    return;
  }

  if (sub === 'info') {
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
      `**Status-Channel:** ${state.statusChannelId ? `<#${state.statusChannelId}>` : '— noch nicht eingerichtet (`/statusbot setup`)'}`,
      `**Meldungen:** ${state.alertChannelId ? `<#${state.alertChannelId}>${state.alertRoleId ? ` mit <@&${state.alertRoleId}>` : ''}` : 'aus'}`,
      `**Server:** \`${config.mcHost}:${config.mcPort}\` · RCON-Port \`${config.rconPort}\``,
      `**RCON:** ${rconLine}`,
      `**Letzte Abfrage:** ${snapshot.checkedAt ? discordTime(snapshot.checkedAt) : '—'} → ${STATUS_LABEL[snapshot.status]}`,
      `**Takt:** Abfrage alle ${config.pollIntervalSec} s · Nachricht spätestens alle ${config.heartbeatSec} s neu`,
      `**Offline-Meldung:** ${config.offlineAlertMinutes ? `nach ${config.offlineAlertMinutes} Min. Ausfall` : 'sofort'}`,
      `**Neustart erlaubt für:** ${ctx.ownerIds().length ? ctx.ownerIds().map((id) => `<@${id}>`).join(', ') : '— (Besitzer noch nicht ermittelt)'} · Startskript \`${config.restartScriptName}\``,
      `**Geplante Neustarts:** ${config.restartSchedule.length
        ? `täglich ${config.restartSchedule.map((t) => t.label).join(', ')} (${config.restartScheduleCountdown} Min. Vorwarnung)`
          + (ctx.getNextRestart() ? ` · nächster ${discordTime(ctx.getNextRestart().at)}` : '')
        : 'aus (`RESTART_SCHEDULE`)'}`,
    ];
    await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  }
}
