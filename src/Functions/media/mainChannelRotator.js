const config = require("../../../config.json");
const { ChannelType } = require("discord.js");
const { readPainelConfig, updatePainelConfig } = require("../painel/store");

const ROTATE_INTERVAL_MS = 7 * 60 * 60 * 1000;

let intervalRef = null;
let rotating = false;

function isGuildTextLike(channel) {
  if (!channel) return false;
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}

function buildChannelSnapshot(channel) {
  return {
    oldId: channel.id,
    guild: channel.guild,
    name: channel.name,
    type: channel.type,
    position: channel.position,
    parentId: channel.parentId || null,
    topic: "topic" in channel ? channel.topic ?? null : null,
    nsfw: "nsfw" in channel ? Boolean(channel.nsfw) : false,
    rateLimitPerUser: "rateLimitPerUser" in channel ? Number(channel.rateLimitPerUser || 0) : 0,
    defaultAutoArchiveDuration:
      "defaultAutoArchiveDuration" in channel && channel.defaultAutoArchiveDuration
        ? Number(channel.defaultAutoArchiveDuration)
        : undefined,
    permissionOverwrites: channel.permissionOverwrites.cache.map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString()
    }))
  };
}

async function deleteOriginalChannel(client, oldId) {
  const original = client.channels.cache.get(oldId) || (await client.channels.fetch(oldId).catch(() => null));
  if (!original) return true;
  await original.delete("Rotacao automatica de canais (7h)");
  return true;
}

async function recreateFromSnapshot(snapshot) {
  const createOptions = {
    name: snapshot.name,
    type: snapshot.type,
    parent: snapshot.parentId || null,
    permissionOverwrites: snapshot.permissionOverwrites,
    reason: "Rotacao automatica de canais (7h)"
  };

  if (snapshot.type === ChannelType.GuildText || snapshot.type === ChannelType.GuildAnnouncement) {
    createOptions.topic = snapshot.topic;
    createOptions.nsfw = snapshot.nsfw;
    createOptions.rateLimitPerUser = snapshot.rateLimitPerUser;
  }

  if (snapshot.defaultAutoArchiveDuration) {
    createOptions.defaultAutoArchiveDuration = snapshot.defaultAutoArchiveDuration;
  }

  const recreated = await snapshot.guild.channels.create(createOptions);

  if (typeof recreated.setPosition === "function") {
    await recreated.setPosition(snapshot.position).catch(() => {});
  }

  return recreated;
}

async function rotateMainChannels(client) {
  if (rotating) return;
  rotating = true;

  try {
    const painel = readPainelConfig();
    const entries = Object.entries(painel.canais || {});
    const uniqueChannelIds = [...new Set(entries.map(([, id]) => id).filter(Boolean))];
    if (!uniqueChannelIds.length) return;

    const mainGuildId = String(config.GUILD_ID || "").trim();
    const replacements = new Map();
    const snapshots = [];

    for (const channelId of uniqueChannelIds) {
      const channel = client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
      if (!channel) continue;
      if (!isGuildTextLike(channel)) continue;
      if (mainGuildId && channel.guildId !== mainGuildId) continue;
      snapshots.push(buildChannelSnapshot(channel));
    }

    if (!snapshots.length) return;

    await Promise.all(
      snapshots.map((snapshot) => deleteOriginalChannel(client, snapshot.oldId).catch(() => null))
    );

    const sortedSnapshots = [...snapshots].sort((a, b) => a.position - b.position);

    for (const snapshot of sortedSnapshots) {
      const recreated = await recreateFromSnapshot(snapshot).catch(() => null);
      if (!recreated) continue;
      replacements.set(snapshot.oldId, recreated.id);
    }

    if (!replacements.size) return;

    updatePainelConfig((cfg) => {
      for (const [tipo, channelId] of Object.entries(cfg.canais || {})) {
        if (channelId && replacements.has(channelId)) {
          cfg.canais[tipo] = replacements.get(channelId);
        }
      }
      return cfg;
    });
  } finally {
    rotating = false;
  }
}

function startMainChannelRotator(client) {
  if (intervalRef) return;

  intervalRef = setInterval(() => {
    rotateMainChannels(client).catch(() => {});
  }, ROTATE_INTERVAL_MS);

  if (typeof intervalRef.unref === "function") intervalRef.unref();
}

module.exports = {
  startMainChannelRotator,
  rotateMainChannels
};
