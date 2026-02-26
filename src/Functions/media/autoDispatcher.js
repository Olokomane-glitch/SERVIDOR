const { readPainelConfig, hasSentMediaUrl, markSentMediaUrl } = require("../painel/store");
const { buildDispatchMediaPayload } = require("./renderMediaContainer");
const { prepareMediaAsset } = require("./mediaNormalizer");
const { channelHasEquivalentMedia } = require("./channelMediaCheck");
const { canSendByType, markSentByType } = require("./sendThrottle");

const SYSTEMS = ["gifs", "avatar", "banners"];
const TICK_MS = 1000;
const MEMBER_COOLDOWN_MS = 30 * 60 * 1000;

let intervalRef = null;
const runtime = {
  lastSentKey: {
    gifs: null,
    avatar: null,
    banners: null
  },
  lastSentMediaUrl: {
    gifs: null,
    avatar: null,
    banners: null
  },
  memberCooldowns: {
    gifs: new Map(),
    avatar: new Map(),
    banners: new Map()
  },
  busy: false
};

function isAnimatedHash(hash) {
  return typeof hash === "string" && hash.startsWith("a_");
}

function hasAnimatedProfile(member) {
  return isAnimatedHash(member.avatar) || isAnimatedHash(member.user?.avatar);
}

function getGifAvatarUrl(member) {
  if (isAnimatedHash(member.avatar)) {
    return member.avatarURL({ extension: "gif", forceStatic: false, size: 4096 });
  }

  if (isAnimatedHash(member.user?.avatar)) {
    return member.user.displayAvatarURL({
      extension: "gif",
      forceStatic: false,
      size: 4096
    });
  }

  return null;
}

function isOnCooldown(type, userId) {
  const expiresAt = runtime.memberCooldowns[type]?.get(userId) || 0;
  return Date.now() < expiresAt;
}

function markCooldown(type, userId) {
  runtime.memberCooldowns[type]?.set(userId, Date.now() + MEMBER_COOLDOWN_MS);
}

function cleanupCooldown(type) {
  const map = runtime.memberCooldowns[type];
  if (!map) return;
  const now = Date.now();
  for (const [userId, expiresAt] of map.entries()) {
    if (expiresAt <= now) map.delete(userId);
  }
}

async function fetchUserBannerUrl(client, userId) {
  try {
    let user = await client.users.fetch(userId, { force: true });
    if (!user.banner) {
      try {
        user = await user.fetch(true);
      } catch {}
    }
    return (
      user.bannerURL({ extension: "gif", forceStatic: false, size: 4096 }) ||
      user.bannerURL({ extension: "webp", forceStatic: true, size: 4096 }) ||
      user.bannerURL({ extension: "png", forceStatic: true, size: 4096 }) ||
      null
    );
  } catch {
    return null;
  }
}

async function resolveChannelAndGuild(client, channelId) {
  if (!channelId) return null;
  const channel =
    client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.guild || typeof channel.send !== "function") return null;
  return { channel, guild: channel.guild };
}

async function ensureMembersLoaded(guild) {
  try {
    await guild.members.fetch();
  } catch {}
}

async function pickCandidateForType(client, guild, type, previousKey) {
  await ensureMembersLoaded(guild);
  cleanupCooldown(type);

  const members = [...guild.members.cache.values()].filter(
    (m) => !m.user.bot && m.user.id !== client.user.id
  );

  if (!members.length) return null;

  const shuffled = members.sort(() => Math.random() - 0.5);
  const maxAttempts = Math.min(shuffled.length, 60);

  for (let i = 0; i < maxAttempts; i += 1) {
    const member = shuffled[i];
    if (isOnCooldown(type, member.user.id)) continue;

    let mediaUrl = null;

    if (type === "gifs") {
      if (!hasAnimatedProfile(member)) continue;
      mediaUrl = getGifAvatarUrl(member);
      if (!mediaUrl || !/\.gif(\?|$)/i.test(mediaUrl)) continue;
    } else if (type === "avatar") {
      if (hasAnimatedProfile(member)) continue;
      mediaUrl = member.displayAvatarURL({
        extension: "png",
        forceStatic: true,
        size: 4096
      });
    } else if (type === "banners") {
      mediaUrl = await fetchUserBannerUrl(client, member.user.id);
      if (!mediaUrl) continue;
    }

    if (!mediaUrl) continue;

    const key = `${member.user.id}:${mediaUrl}`;
    if (previousKey && key === previousKey && members.length > 1) continue;
    if (runtime.lastSentMediaUrl[type] && runtime.lastSentMediaUrl[type] === mediaUrl && members.length > 1) continue;
    if (hasSentMediaUrl(type, mediaUrl)) continue;

    return {
      userId: member.user.id,
      mediaUrl,
      key
    };
  }

  return null;
}

async function sendAndDeleteIfBroken(channel, payload) {
  const sent = await channel.send(payload);
  const hasVisibleImage =
    sent.attachments?.size > 0 ||
    sent.embeds?.some((embed) => Boolean(embed?.image?.url || embed?.thumbnail?.url));

  if (!hasVisibleImage) {
    await sent.delete().catch(() => {});
    return false;
  }

  return true;
}

async function sendSystemMedia(client, type) {
  const painel = readPainelConfig();
  const system = painel.sistemas[type];
  const channelId = painel.canais[type];

  if (!system?.ligado) return;
  if (!channelId) return;

  const intervalSeconds = Math.max(1, Number(system.tempoSegundos || 60));
  if (!canSendByType(type, intervalSeconds)) return;

  const ctx = await resolveChannelAndGuild(client, channelId);
  if (!ctx) return;

  const candidate = await pickCandidateForType(client, ctx.guild, type, runtime.lastSentKey[type]);
  if (!candidate) return;

  const alreadyInChannel = await channelHasEquivalentMedia(ctx.channel, candidate.mediaUrl);
  if (alreadyInChannel) {
    runtime.lastSentKey[type] = candidate.key;
    runtime.lastSentMediaUrl[type] = candidate.mediaUrl;
    markSentMediaUrl(type, candidate.mediaUrl);
    markCooldown(type, candidate.userId);
    return;
  }

  const media = await prepareMediaAsset(candidate.mediaUrl, type);
  if (!media.normalized || !media.files.length) return;

  const payload = buildDispatchMediaPayload({
    mediaUrl: candidate.mediaUrl,
    displayUrl: media.displayUrl,
    downloadUrl: media.downloadUrl,
    files: media.files,
    serverName: ctx.guild.name
  });

  const ok = await sendAndDeleteIfBroken(ctx.channel, payload).catch(() => false);
  if (!ok) return;

  runtime.lastSentKey[type] = candidate.key;
  runtime.lastSentMediaUrl[type] = candidate.mediaUrl;
  markSentMediaUrl(type, candidate.mediaUrl);
  markSentByType(type);
  markCooldown(type, candidate.userId);
}

async function tick(client) {
  if (runtime.busy) return;
  runtime.busy = true;

  try {
    for (const type of SYSTEMS) {
      await sendSystemMedia(client, type);
    }
  } finally {
    runtime.busy = false;
  }
}

function startAutoDispatcher(client) {
  if (intervalRef) return;

  intervalRef = setInterval(() => {
    tick(client).catch(() => {});
  }, TICK_MS);

  if (typeof intervalRef.unref === "function") intervalRef.unref();

  tick(client).catch(() => {});
}

module.exports = {
  startAutoDispatcher
};

