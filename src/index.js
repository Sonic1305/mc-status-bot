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
import { commandData, handleCommand } from './commands.js';
import { config, validateConfig } from './config.js';
import { buildStatusEmbed, buildStoppedEmbed, presenceFor, statusSignature } from './embed.js';
import { log } from './log.js';
import { Monitor } from './monitor.js';
import { RestartManager } from './restart.js';
import { loadState, saveState } from './state.js';
import { EXIT_UPDATE_INSTALLED, Updater } from './updater.js';

// Exit-Code 2 = Konfigurationsfehler: start-bot.bat startet dann nicht endlos neu.
const EXIT_CONFIG_ERROR = 2;
// Startet der Bot innerhalb dieser Zeit neu und der Server lief durch, bleibt "Online seit" erhalten.
const RESUME_WINDOW_MS = 10 * 60 * 1000;

log.info(`Minecraft Status-Bot v${config.version} startet …`);

const { errors, warnings } = validateConfig();
warnings.forEach((w) => log.warn(w));
if (errors.length) {
  errors.forEach((e) => log.error(e));
  log.error('Bitte die .env korrigieren und den Bot neu starten.');
  process.exit(EXIT_CONFIG_ERROR);
}

const state = loadState();
const monitor = new Monitor(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let pollTimer = null;
let shuttingDown = false;
let lastSignature = null;
let lastEditAt = 0;
let lastPresenceKey = null;
let lastPublishError = null;
let ownerIds = [...config.ownerIds];

const save = () => {
  try {
    saveState(state);
  } catch (err) {
    log.error('state.json konnte nicht gespeichert werden:', err.message);
  }
};

const restartManager = new RestartManager({
  config,
  state,
  save,
  monitor,
  notify: (alert) => { sendAlert(alert); },
  refresh: () => refreshStatus(true),
});
restartManager.recoverAfterBotStart();

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
  await sendAlert({
    text: `⬆️ **Status-Bot wird auf v${result.version} aktualisiert** (bisher v${config.version}). `
      + 'Der Bot startet kurz neu, der Minecraft-Server läuft weiter.',
  });
  shutdown('Update', EXIT_UPDATE_INSTALLED);
}

/** Nach dem ersten vollständigen Durchlauf: frisch installierte Version als gesund markieren. */
async function confirmUpdateHealthy() {
  if (healthConfirmed) return;
  healthConfirmed = true;
  const pending = updater.confirmHealthy();
  if (pending) {
    log.info(`Update auf v${pending.to} erfolgreich.`);
    await sendAlert({ text: `✅ **Status-Bot läuft jetzt mit v${pending.to}.**${quoteNotes(pending.notes)}` });
  }
}

const dayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
});

const DISCORD_ERRORS = {
  10003: 'Der Channel existiert nicht mehr.',
  10008: 'Die Nachricht existiert nicht mehr.',
  50001: 'Dem Bot fehlt der Zugriff auf den Channel (Recht „Kanal ansehen“).',
  50013: 'Dem Bot fehlen Rechte im Channel (Nachrichten senden, Links einbetten, Nachrichtenverlauf lesen).',
};
const describeDiscordError = (err) => DISCORD_ERRORS[err?.code] ?? err?.message ?? String(err);

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
      log.warn('Der Status-Channel wurde gelöscht – in Discord /statusbot setup erneut ausführen.');
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
      log.warn('Die Status-Nachricht wurde gelöscht – poste sie neu.');
    }
  }
  const message = await channel.send({ embeds: [embed] });
  state.statusMessageId = message.id;
  save();
  log.info(`Status-Nachricht in #${channel.name} gepostet.`);
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
    await runExclusive(() => publishNow(buildStatusEmbed({ snapshot, state, config, now })));
    lastSignature = signature;
    lastEditAt = now;
    if (lastPublishError) {
      log.info('Die Status-Nachricht wird wieder aktualisiert.');
      lastPublishError = null;
    }
    return null;
  } catch (err) {
    const message = describeDiscordError(err);
    if (message !== lastPublishError) {
      log.error(`Status-Nachricht konnte nicht aktualisiert werden: ${message}`);
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
  if (!client.user) return;
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

async function sendAlert({ text, ping = false }) {
  if (!state.alertChannelId) return;
  const roleId = ping ? state.alertRoleId : null;
  try {
    const channel = await client.channels.fetch(state.alertChannelId);
    await channel.send({
      content: roleId ? `<@&${roleId}> ${text}` : text,
      allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
    });
  } catch (err) {
    log.error(`Meldung konnte nicht gesendet werden: ${describeDiscordError(err)}`);
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

  // Laufender Neustart per /server neustart (schickt seine Meldungen selbst)
  restartManager.onPoll(snapshot, now);
  const restarting = Boolean(state.restart);

  // Online/Offline-Wechsel
  if (up && prevStatus !== 'online') {
    const resumed = prevStatus === 'unknown' && state.onlineSince && state.stoppedAt
      && now - state.stoppedAt < RESUME_WINDOW_MS;
    if (resumed) {
      log.info('Server läuft weiterhin.');
    } else {
      state.onlineSince = now;
      log.info('Server ist online.');
      if (state.offlineAlert === 'sent') {
        alerts.push({ text: `🟢 **${config.serverName} ist wieder online.**`, ping: true });
      } else if (prevStatus === 'unknown') {
        alerts.push({ text: `🟢 **${config.serverName} ist online.**`, ping: true });
      }
      // Sonst: kurzer Ausfall (z. B. Neustart) – Status-Nachricht zeigt es, aber kein Ping.
    }
    state.offlineSince = null;
    state.offlineAlert = null;
    state.offlinePlayers = null;
  } else if (!up && prevStatus !== 'offline') {
    state.offlineSince = now;
    state.onlineSince = null;
    log.warn('Server ist offline bzw. nicht erreichbar.');
    if (prevStatus === 'online' && !restarting) {
      state.offlineAlert = 'pending';
      state.offlinePlayers = prevSnapshot.players.map((p) => p.name);
    }
  }

  // Offline-Meldung erst, wenn der Ausfall länger als OFFLINE_ALERT_MINUTES dauert
  if (!up && !restarting && state.offlineAlert === 'pending'
    && now - state.offlineSince >= config.offlineAlertMinutes * 60 * 1000) {
    state.offlineAlert = 'sent';
    const since = config.offlineAlertMinutes ? `seit ${config.offlineAlertMinutes} Min. ` : '';
    const who = state.offlinePlayers?.length ? ` Zuletzt online: ${state.offlinePlayers.map(escapeMarkdown).join(', ')}` : '';
    alerts.push({ text: `🔴 **${config.serverName} ist ${since}offline.**${who}`, ping: true });
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
      if (previousRecord > 0) {
        alerts.push({ text: `🎉 **Neuer Spielerrekord:** ${snapshot.online} Spieler gleichzeitig online!` });
      }
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
    log.error('Fehler im Update-Zyklus:', err);
  }
  if (!shuttingDown) pollTimer = setTimeout(tick, config.pollIntervalSec * 1000);
}

// ---------------------------------------------------------------------------
// Discord-Events
// ---------------------------------------------------------------------------

async function registerCommands(guild) {
  try {
    await guild.commands.set(commandData);
  } catch (err) {
    log.error(`Slash-Befehle auf „${guild.name}“ konnten nicht registriert werden: ${describeDiscordError(err)}`);
  }
}

/** Wer /server neustart ausführen darf: OWNER_IDS aus der .env, sonst der Besitzer der Discord-Application. */
async function resolveOwners(readyClient) {
  if (!config.ownerIds.length) {
    try {
      const { owner } = await readyClient.application.fetch();
      // Gehört die Application einem Team, zählt dessen Besitzer.
      const id = owner && 'ownerId' in owner ? owner.ownerId : owner?.id;
      ownerIds = id ? [id] : [];
    } catch (err) {
      log.error(`Bot-Besitzer konnte nicht ermittelt werden (${describeDiscordError(err)}) – /server ist gesperrt.`);
      ownerIds = [];
    }
  }
  if (ownerIds.length) {
    const names = await Promise.all(ownerIds.map((id) => readyClient.users.fetch(id).then((u) => u.tag, () => '?')));
    log.info(`/server neustart erlaubt für: ${ownerIds.map((id, i) => `${names[i]} (${id})`).join(', ')}.`);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  log.info(`Bei Discord angemeldet als ${readyClient.user.tag}.`);
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
  if (readyClient.guilds.cache.size === 0) {
    log.warn(`Der Bot ist noch auf keinem Discord-Server. Mit diesem Link einladen:\n  ${invite}`);
  } else {
    log.info(`Einladungslink (falls benötigt): ${invite}`);
  }

  await resolveOwners(readyClient);
  for (const guild of readyClient.guilds.cache.values()) await registerCommands(guild);
  if (!state.statusChannelId) log.warn('Noch kein Status-Channel gesetzt – in Discord „/statusbot setup“ ausführen.');

  log.info(`Frage ${config.mcHost}:${config.mcPort} alle ${config.pollIntervalSec} s ab${monitor.rconEnabled ? ` (RCON-Port ${config.rconPort})` : ' (nur Status-Ping)'}.`);

  const rolledBack = updater.takeRollbackNotice();
  if (rolledBack) {
    log.warn(`Update auf v${rolledBack.to} ist fehlgeschlagen, v${rolledBack.from} wurde wiederhergestellt.`);
    sendAlert({
      text: `⚠️ **Status-Bot-Update auf v${rolledBack.to} fehlgeschlagen** – die neue Version ist beim Start abgestürzt, `
        + `v${rolledBack.from} wurde automatisch wiederhergestellt. v${rolledBack.to} wird nicht erneut automatisch installiert.`,
    });
  }
  updater.start();
  tick();
});

client.on(Events.GuildCreate, (guild) => {
  log.info(`Zu Discord-Server „${guild.name}“ hinzugefügt.`);
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
      isOwner: (userId) => ownerIds.includes(userId),
      ownerIds: () => ownerIds,
      restart: restartManager,
      updater,
      onUpdateInstalled: restartForUpdate,
      rconEnabled: monitor.rconEnabled,
      moveStatusMessage,
      refreshStatus: () => refreshStatus(true),
    });
  } catch (err) {
    log.error(`Fehler bei /${interaction.commandName}:`, err);
    const content = `❌ Fehler: ${describeDiscordError(err)}`;
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
  log.info(`Beende Bot (${signal}) …`);
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
        client.user.setPresence({ status: 'invisible', activities: [] });
      }
    } catch (err) {
      log.warn(`Konnte die Anzeige nicht auf „beendet“ setzen: ${describeDiscordError(err)}`);
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
process.on('unhandledRejection', (err) => log.error('Unbehandelter Fehler:', err));
process.on('uncaughtException', (err) => {
  log.error('Absturz:', err);
  process.exit(1);
});

client.login(config.discordToken).catch((err) => {
  if (err.code === 'TokenInvalid' || err.status === 401) {
    log.error('DISCORD_TOKEN ist ungültig. Im Developer Portal unter „Bot“ → „Reset Token“ einen neuen erzeugen und in die .env eintragen.');
    process.exit(EXIT_CONFIG_ERROR);
  }
  log.error('Anmeldung bei Discord fehlgeschlagen:', err);
  process.exit(1);
});
