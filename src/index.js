import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  OAuth2Scopes,
  PermissionFlagsBits,
  escapeMarkdown,
} from 'discord.js';
import { buildCommandData, handleCommand } from './commands.js';
import { applyStoredDefaults, config, validateConfig } from './config.js';
import { buildStatusEmbed, buildStoppedEmbed, presenceFor, statusSignature } from './embed.js';
import { locale, setLanguage, t } from './i18n.js';
import { log } from './log.js';
import { Monitor, playerChanges } from './monitor.js';
import { RestartManager } from './restart.js';
import { RestartScheduler } from './schedule.js';
import { loadState, saveState } from './state.js';
import { correctedOnlineSince, getListeningProcessStart } from './uptime.js';
import { EXIT_UPDATE_INSTALLED, Updater } from './updater.js';

// Exit-Code 2 = Konfigurationsfehler: start-bot.bat startet dann nicht endlos neu.
const EXIT_CONFIG_ERROR = 2;
// Startet der Bot innerhalb dieser Zeit neu und der Server lief durch, bleibt "Online seit" erhalten.
const RESUME_WINDOW_MS = 10 * 60 * 1000;

// Zuerst den Zustand laden: Er enthält die Standards älterer Installationen (z. B. Sprache Deutsch).
const state = loadState();
applyStoredDefaults(state.storedDefaults);
setLanguage(config.language);

log.info(t('log.starting', { version: config.version }));
log.info(t('log.language', { language: t(`language.${config.language}`), source: config.languageSource }));

const { errors, warnings } = validateConfig();
warnings.forEach((w) => log.warn(w));
if (errors.length) {
  errors.forEach((e) => log.error(e));
  log.error(t('log.fixConfig'));
  process.exit(EXIT_CONFIG_ERROR);
}

const monitor = new Monitor(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let pollTimer = null;
let shuttingDown = false;
let lastSignature = null;
let lastEditAt = 0;
let lastPresenceKey = null;
let lastPublishError = null;
let lastUptimeCheck = 0;
const UPTIME_CHECK_INTERVAL_MS = 10 * 60 * 1000;
let ownerIds = [...config.ownerIds];

const save = () => {
  try {
    saveState(state);
  } catch (err) {
    log.error(t('log.stateSaveFailed'), err.message);
  }
};
save(); // schreibt eine Umstellung von state.json auf das neue Format sofort

const restartManager = new RestartManager({
  config,
  state,
  save,
  monitor,
  notify: (alert) => { sendAlert(alert); },
  refresh: () => refreshStatus(true),
});
restartManager.recoverAfterBotStart();

const scheduler = new RestartScheduler({
  config,
  state,
  save,
  restartManager,
  notify: (alert) => { sendAlert(alert); },
});

let healthConfirmed = false;
const updater = new Updater({
  config,
  currentVersion: config.version,
  isBusy: () => Boolean(state.restart), // nie während eines Server-Neustarts
  onInstalled: (result) => { restartForUpdate(result); },
});

const quoteNotes = (notes) => (notes
  ? `\n${notes.slice(0, 1500).split('\n').map((line) => `> ${line}`).join('\n')}`
  : '');

async function restartForUpdate(result) {
  await sendAlert({ type: 'update', text: t('alert.botUpdating', { version: result.version, current: config.version }) });
  shutdown('Update', EXIT_UPDATE_INSTALLED);
}

/** Nach dem ersten vollständigen Durchlauf: frisch installierte Version als gesund markieren. */
async function confirmUpdateHealthy() {
  if (healthConfirmed) return;
  healthConfirmed = true;
  const pending = updater.confirmHealthy();
  if (pending) {
    log.info(t('log.updateSucceeded', { version: pending.to }));
    await sendAlert({ type: 'update', text: t('alert.botUpdated', { version: pending.to }) + quoteNotes(pending.notes) });
  }
}

const dayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
});

const DISCORD_ERRORS = {
  10003: 'discord.unknownChannel',
  10008: 'discord.unknownMessage',
  50001: 'discord.missingAccess',
  50013: 'discord.missingPermissions',
};
const describeDiscordError = (err) => (DISCORD_ERRORS[err?.code] ? t(DISCORD_ERRORS[err.code]) : err?.message ?? String(err));

// ---------------------------------------------------------------------------
// Status-Nachricht
// ---------------------------------------------------------------------------

// Alles, was die Status-Nachricht anfasst, läuft nacheinander – sonst könnten zwei
// gleichzeitige Aufrufe jeweils eine neue Nachricht posten.
let exclusiveChain = Promise.resolve();
function runExclusive(fn) {
  const result = exclusiveChain.then(fn, fn);
  exclusiveChain = result.catch(() => {});
  return result;
}

async function publishNow(embed) {
  if (!state.statusChannelId) return;
  let channel;
  try {
    channel = await client.channels.fetch(state.statusChannelId);
  } catch (err) {
    if (err.code === 10003) {
      log.warn(t('log.statusChannelDeleted'));
      state.statusChannelId = null;
      state.statusMessageId = null;
      save();
      return;
    }
    throw err;
  }

  if (state.statusMessageId) {
    try {
      await channel.messages.edit(state.statusMessageId, { embeds: [embed] });
      return;
    } catch (err) {
      if (err.code !== 10008) throw err;
      log.warn(t('log.statusMessageDeleted'));
    }
  }
  const message = await channel.send({ embeds: [embed] });
  state.statusMessageId = message.id;
  save();
  log.info(t('log.statusMessagePosted', { channel: channel.name }));
}

/** Aktualisiert Nachricht und Präsenz. Liefert eine Fehlerbeschreibung oder null. */
async function refreshStatus(force = false) {
  const snapshot = monitor.snapshot;
  updatePresence(snapshot);

  const signature = statusSignature(snapshot, state, config);
  const now = Date.now();
  const due = force || signature !== lastSignature || now - lastEditAt >= config.heartbeatSec * 1000;
  if (!due) return null;

  try {
    await runExclusive(() => publishNow(buildStatusEmbed({ snapshot, state, config, now, nextRestart: scheduler.upcoming })));
    lastSignature = signature;
    lastEditAt = now;
    if (lastPublishError) {
      log.info(t('log.statusMessageWorking'));
      lastPublishError = null;
    }
    return null;
  } catch (err) {
    const message = describeDiscordError(err);
    if (message !== lastPublishError) {
      log.error(t('log.statusMessageFailed', { error: message }));
      lastPublishError = message;
    }
    return message;
  }
}

async function moveStatusMessage(channelId) {
  await runExclusive(async () => {
    if (state.statusChannelId && state.statusMessageId) {
      try {
        const old = await client.channels.fetch(state.statusChannelId);
        await old.messages.delete(state.statusMessageId);
      } catch {
        // Alte Nachricht ist schon weg – egal.
      }
    }
    state.statusChannelId = channelId;
    state.statusMessageId = null;
    save();
  });
  return refreshStatus(true);
}

function updatePresence(snapshot) {
  if (!client.user || !config.showPresence) return;
  const presence = presenceFor(snapshot, state);
  const key = JSON.stringify(presence);
  if (key === lastPresenceKey) return;
  lastPresenceKey = key;
  client.user.setPresence({
    status: presence.status,
    activities: [{ type: ActivityType.Custom, name: 'custom', state: presence.text }],
  });
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

// Meldungstypen, die sich per .env abschalten lassen. Alles andere (z. B. 'problem') wird immer gesendet.
const ALERT_SWITCHES = {
  offline: () => config.alertOffline,
  records: () => config.alertRecords,
  restart: () => config.alertRestarts,
  update: () => config.alertBotUpdates,
  join: () => config.alertJoinLeave,
};

async function sendAlert({ text, type = 'problem', ping = false }) {
  if (!state.alertChannelId) return;
  if (ALERT_SWITCHES[type] && !ALERT_SWITCHES[type]()) return;
  const roleId = ping ? state.alertRoleId : null;
  try {
    const channel = await client.channels.fetch(state.alertChannelId);
    await channel.send({
      content: roleId ? `<@&${roleId}> ${text}` : text,
      allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
    });
  } catch (err) {
    log.error(t('log.alertFailed', { error: describeDiscordError(err) }));
  }
}

// ---------------------------------------------------------------------------
// Abfrage-Schleife
// ---------------------------------------------------------------------------

async function pollOnce() {
  const prevStatus = state.lastStatus ?? 'unknown';
  const prevSnapshot = monitor.snapshot;
  const snapshot = await monitor.poll();
  const now = Date.now();
  const up = snapshot.status === 'online' || snapshot.status === 'degraded';
  const alerts = [];

  // Laufender Neustart (/mc server restart oder Zeitplan) – schickt seine Meldungen selbst
  await restartManager.onPoll(snapshot, now);
  const restarting = Boolean(state.restart);

  // Online/Offline-Wechsel
  if (up && prevStatus !== 'online') {
    const resumed = prevStatus === 'unknown' && state.onlineSince && state.stoppedAt
      && now - state.stoppedAt < RESUME_WINDOW_MS;
    if (resumed) {
      log.info(t('log.serverStillRunning'));
    } else {
      state.onlineSince = now;
      log.info(t('log.serverOnline'));
      if (state.offlineAlert === 'sent') {
        alerts.push({ type: 'offline', text: t('alert.backOnline', { name: config.serverName }), ping: true });
      } else if (prevStatus === 'unknown') {
        alerts.push({ type: 'offline', text: t('alert.online', { name: config.serverName }), ping: true });
      }
      // Sonst: kurzer Ausfall (z. B. Neustart) – Status-Nachricht zeigt es, aber kein Ping.
    }
    state.offlineSince = null;
    state.offlineAlert = null;
    state.offlinePlayers = null;
  } else if (!up && prevStatus !== 'offline') {
    state.offlineSince = now;
    state.onlineSince = null;
    log.warn(t('log.serverOffline'));
    if (prevStatus === 'online' && !restarting) {
      state.offlineAlert = 'pending';
      state.offlinePlayers = prevSnapshot.players.map((p) => p.name);
    }
  }

  // Offline-Meldung erst, wenn der Ausfall länger als OFFLINE_ALERT_MINUTES dauert
  if (!up && !restarting && state.offlineAlert === 'pending'
    && now - state.offlineSince >= config.offlineAlertMinutes * 60 * 1000) {
    state.offlineAlert = 'sent';
    alerts.push({
      type: 'offline',
      text: t('alert.offline', {
        name: config.serverName,
        minutes: config.offlineAlertMinutes,
        players: state.offlinePlayers?.length ? state.offlinePlayers.map(escapeMarkdown).join(', ') : null,
      }),
      ping: true,
    });
  }
  // "Online seit" mit der Startzeit des Serverprozesses abgleichen (beim Bot-Start und alle 10 Min.)
  if (up && !state.restart && now - lastUptimeCheck >= UPTIME_CHECK_INTERVAL_MS) {
    lastUptimeCheck = now;
    const processStart = await getListeningProcessStart(config.mcPort, { host: config.mcHost });
    const corrected = correctedOnlineSince(state.onlineSince, processStart);
    if (corrected) {
      log.info(t('log.onlineSinceCorrected', { time: new Date(corrected).toLocaleString(locale(), { timeZone: config.timezone }) }));
      state.onlineSince = corrected;
    }
  }

  // Wer ist gekommen/gegangen? (ALERT_JOIN_LEAVE)
  if (config.alertJoinLeave && !restarting) {
    const changes = playerChanges(prevSnapshot, snapshot);
    if (changes) {
      const names = (list) => list.map((name) => `**${escapeMarkdown(name)}**`).join(', ');
      const parts = [];
      if (changes.joined.length) parts.push(t('alert.joined', { names: names(changes.joined), count: changes.joined.length }));
      if (changes.left.length) parts.push(t('alert.left', { names: names(changes.left), count: changes.left.length }));
      alerts.push({ type: 'join', text: parts.join('\n') });
    }
  }

  state.lastStatus = up ? 'online' : 'offline';
  state.stoppedAt = null;

  // Rekorde
  const today = dayFormat.format(now);
  if (state.peakToday?.date !== today) state.peakToday = { date: today, count: 0 };
  if (up) {
    state.peakToday.count = Math.max(state.peakToday.count, snapshot.online);
    const previousRecord = state.record?.count ?? 0;
    if (snapshot.online > previousRecord) {
      state.record = { count: snapshot.online, at: now };
      if (previousRecord > 0) alerts.push({ type: 'records', text: t('alert.newRecord', { count: snapshot.online }) });
    }
  }

  save();
  await refreshStatus();
  for (const alert of alerts) await sendAlert(alert);
}

async function tick() {
  if (shuttingDown) return;
  try {
    await pollOnce();
    await confirmUpdateHealthy();
  } catch (err) {
    log.error(t('log.pollError'), err);
  }
  if (!shuttingDown) pollTimer = setTimeout(tick, config.pollIntervalSec * 1000);
}

// ---------------------------------------------------------------------------
// Discord-Events
// ---------------------------------------------------------------------------

async function registerCommands(guild) {
  try {
    await guild.commands.set(buildCommandData());
  } catch (err) {
    log.error(t('log.commandsFailed', { guild: guild.name, error: describeDiscordError(err) }));
  }
}

/** Bot-Besitzer (darf /mc server … und /mc bot update): OWNER_IDS aus der .env, sonst der Besitzer der Discord-Application. */
async function resolveOwners(readyClient) {
  if (!config.ownerIds.length) {
    try {
      const { owner } = await readyClient.application.fetch();
      // Gehört die Application einem Team, zählt dessen Besitzer.
      const id = owner && 'ownerId' in owner ? owner.ownerId : owner?.id;
      ownerIds = id ? [id] : [];
    } catch (err) {
      log.error(t('log.ownerUnknown', { error: describeDiscordError(err) }));
      ownerIds = [];
    }
  }
  if (ownerIds.length) {
    const names = await Promise.all(ownerIds.map((id) => readyClient.users.fetch(id).then((u) => u.tag, () => '?')));
    log.info(t('log.owners', { owners: ownerIds.map((id, i) => `${names[i]} (${id})`).join(', ') }));
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  log.info(t('log.loggedIn', { tag: readyClient.user.tag }));
  const invite = readyClient.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.MentionEveryone,
    ],
  });
  if (readyClient.guilds.cache.size === 0) log.warn(t('log.noGuild', { invite }));
  else log.info(t('log.invite', { invite }));

  await resolveOwners(readyClient);
  for (const guild of readyClient.guilds.cache.values()) await registerCommands(guild);
  if (!state.statusChannelId) log.warn(t('log.noStatusChannel'));

  log.info(t('log.polling', {
    host: config.mcHost, port: config.mcPort, seconds: config.pollIntervalSec, rconPort: monitor.rconEnabled ? config.rconPort : null,
  }));

  const rolledBack = updater.takeRollbackNotice();
  if (rolledBack) {
    log.warn(t('log.updateRolledBack', rolledBack));
    sendAlert({ text: t('alert.updateRolledBack', rolledBack) });
  }
  updater.start();
  scheduler.start();
  tick();
});

client.on(Events.GuildCreate, (guild) => {
  log.info(t('log.guildJoined', { guild: guild.name }));
  registerCommands(guild);
});

// Nach einem Neuaufbau der Gateway-Verbindung die Präsenz neu setzen.
client.on(Events.ShardReady, () => {
  lastPresenceKey = null;
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction, {
      config,
      state,
      save,
      getSnapshot: () => monitor.snapshot,
      getRconError: () => monitor.rconError,
      getTpsCommand: () => monitor.tpsCommand,
      isOwner: (userId) => ownerIds.includes(userId),
      ownerIds: () => ownerIds,
      restart: restartManager,
      updater,
      onUpdateInstalled: restartForUpdate,
      getNextRestart: () => scheduler.upcoming,
      rconEnabled: monitor.rconEnabled,
      moveStatusMessage,
      refreshStatus: () => refreshStatus(true),
    });
  } catch (err) {
    log.error(t('log.commandError', { command: `/${interaction.commandName}` }), err);
    const content = t('cmd.error', { error: describeDiscordError(err) });
    if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Start & sauberes Beenden
// ---------------------------------------------------------------------------

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(pollTimer);
  updater.stop();
  scheduler.stop();
  log.info(t('log.stopping', { signal }));
  // Windows gibt beim Schließen des Fensters nur wenige Sekunden Zeit.
  setTimeout(() => process.exit(exitCode), 4000);

  restartManager.abortOnShutdown();
  state.lastStatus = 'unknown';
  state.stoppedAt = Date.now();
  save();
  // Bei einem Update startet der Bot sofort neu – dann nicht erst "beendet" anzeigen.
  if (exitCode !== EXIT_UPDATE_INSTALLED) {
    try {
      if (client.isReady()) {
        await runExclusive(() => publishNow(buildStoppedEmbed({ config })));
        if (config.showPresence) client.user.setPresence({ status: 'invisible', activities: [] });
      }
    } catch (err) {
      log.warn(t('log.stoppedEmbedFailed', { error: describeDiscordError(err) }));
    }
  }
  monitor.close();
  await client.destroy();
  process.exit(exitCode);
}

// SIGHUP = Konsolenfenster wird geschlossen, SIGBREAK = Strg+Pause.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => shutdown(signal));
}
process.on('unhandledRejection', (err) => log.error(t('log.unhandled'), err));
process.on('uncaughtException', (err) => {
  log.error(t('log.crash'), err);
  process.exit(1);
});

client.login(config.discordToken).catch((err) => {
  if (err.code === 'TokenInvalid' || err.status === 401) {
    log.error(t('log.tokenInvalid'));
    process.exit(EXIT_CONFIG_ERROR);
  }
  log.error(t('log.loginFailed'), err);
  process.exit(1);
});
