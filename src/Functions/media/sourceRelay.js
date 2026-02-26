const { readPainelConfig, hasSentMediaUrl, markSentMediaUrl } = require("../painel/store");
const { buildDispatchMediaPayload } = require("./renderMediaContainer");
const { prepareMediaAsset } = require("./mediaNormalizer");
const { channelHasEquivalentMedia } = require("./channelMediaCheck");
const { canSendByType, markSentByType } = require("./sendThrottle");

const POLL_INTERVAL_MS = 10000;
const QUEUE_TICK_MS = 1000;
const PROCESSED_MAX = 500;

let pollRef = null;
let queueRef = null;
let relayClient = null;
const processedMessageIds = new Set();
const relayState = {
  queues: { gifs: [], avatar: [], banners: [] },
  lastSentAt: { gifs: 0, avatar: 0, banners: 0 },
  sending: false
};

function cleanupProcessedIds() {
  if (processedMessageIds.size <= PROCESSED_MAX) return;
  const extra = processedMessageIds.size - PROCESSED_MAX;
  let i = 0;
  for (const id of processedMessageIds) {
    processedMessageIds.delete(id);
    i += 1;
    if (i >= extra) break;
  }
}

function markProcessed(messageId) {
  processedMessageIds.add(String(messageId));
  cleanupProcessedIds();
}

function alreadyProcessed(messageId) {
  return processedMessageIds.has(String(messageId));
}

function getSourceEntries() {
  const painel = readPainelConfig();
  return Array.isArray(painel.servidoresOrigens) ? painel.servidoresOrigens : [];
}

function getSourceType(message) {
  if (!message.inGuild()) return null;

  for (const entry of getSourceEntries()) {
    if (entry.ligado === false) continue;
    if (entry.idServidor && message.guildId !== entry.idServidor) continue;
    if (message.channelId === entry.idCanalGifs) return "gifs";
    if (message.channelId === entry.idCanalAvatar) return "avatar";
    if (message.channelId === entry.idCanalBanners) return "banners";
  }

  return null;
}

function attachmentMatchesType(type, attachment) {
  const name = String(attachment.name || "").toLowerCase();
  const contentType = String(attachment.contentType || "").toLowerCase();
  const url = String(attachment.url || "").toLowerCase();
  const isGif = name.endsWith(".gif") || contentType.includes("gif") || /\.gif(\?|$)/.test(url);
  const isImage =
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif)(\?|$)/.test(url) ||
    /\.(png|jpe?g|webp|gif|avif)$/.test(name);

  if (type === "gifs") return isGif;
  if (type === "avatar") return isImage && !isGif;
  if (type === "banners") return isImage;
  return false;
}

function getEmbedsAsPseudoAttachments(message) {
  const list = [];
  for (const embed of message.embeds || []) {
    const candidates = [embed.image?.url, embed.thumbnail?.url, embed.video?.url].filter(Boolean);
    for (const url of candidates) {
      list.push({ url, name: url.split("/").pop() || "embed", contentType: "" });
    }
  }
  return list;
}

function collectUrlsDeep(value, out) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectUrlsDeep(item, out);
    return;
  }
  if (typeof value !== "object") return;

  if (typeof value.url === "string") out.push(value.url);
  if (typeof value.proxy_url === "string") out.push(value.proxy_url);
  if (value.media && typeof value.media.url === "string") out.push(value.media.url);

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") collectUrlsDeep(nested, out);
  }
}

function getComponentsAsPseudoAttachments(message) {
  const urls = [];
  collectUrlsDeep(message.components || [], urls);
  return [...new Set(urls)].map((url) => ({
    url,
    name: url.split("/").pop() || "component",
    contentType: ""
  }));
}

function enqueueRelayMedia(message, type, medias) {
  const queue = relayState.queues[type];
  const seen = new Set();

  for (const media of medias) {
    const mediaUrl = String(media?.url || "");
    if (!mediaUrl || seen.has(mediaUrl)) continue;
    seen.add(mediaUrl);

    if (hasSentMediaUrl(type, mediaUrl)) continue;

    const duplicated = queue.some(
      (item) => item.sourceMessageId === message.id && item.mediaUrl === mediaUrl
    );
    if (duplicated) continue;

    queue.push({ mediaUrl, sourceMessageId: message.id });
  }
}

async function forwardSourceMessage(message) {
  if (!message.inGuild()) return;
  if (message.author?.id === message.client.user?.id) return;
  if (alreadyProcessed(message.id)) return;

  relayClient = message.client || relayClient;
  const type = getSourceType(message);
  if (!type) return;

  const painel = readPainelConfig();
  const destChannelId = painel.canais[type];
  const system = painel.sistemas[type];
  if (!destChannelId || !system?.ligado) return;

  const rawAttachments = [...message.attachments.values()];
  const embedMedia = getEmbedsAsPseudoAttachments(message);
  const componentMedia = getComponentsAsPseudoAttachments(message);
  const medias = [...rawAttachments, ...embedMedia, ...componentMedia].filter((att) =>
    attachmentMatchesType(type, att)
  );
  if (!medias.length) return;

  enqueueRelayMedia(message, type, medias);
  markProcessed(message.id);
  if (relayClient) await processRelayQueues(relayClient).catch(() => {});
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

async function sendOneQueuedMedia(client, type) {
  const queue = relayState.queues[type];
  if (!queue.length) return;

  const painel = readPainelConfig();
  const system = painel.sistemas[type];
  const destChannelId = painel.canais[type];
  if (!destChannelId || !system?.ligado) return;

  const intervalSeconds = Math.max(1, Number(system.tempoSegundos || 60));
  if (!canSendByType(type, intervalSeconds)) return;

  const destination =
    client.channels.cache.get(destChannelId) ||
    (await client.channels.fetch(destChannelId).catch(() => null));
  if (!destination || typeof destination.send !== "function") return;

  const item = queue.shift();
  if (!item) return;

  const alreadyInChannel = await channelHasEquivalentMedia(destination, item.mediaUrl);
  if (alreadyInChannel) {
    markSentMediaUrl(type, item.mediaUrl);
    return;
  }

  const media = await prepareMediaAsset(item.mediaUrl, type);
  if (!media.normalized || !media.files.length) return;

  const payload = buildDispatchMediaPayload({
    mediaUrl: item.mediaUrl,
    displayUrl: media.displayUrl,
    downloadUrl: media.downloadUrl,
    files: media.files,
    serverName: destination.guild?.name || "Servidor"
  });

  const ok = await sendAndDeleteIfBroken(destination, payload).catch(() => false);
  if (!ok) return;

  markSentMediaUrl(type, item.mediaUrl);
  markSentByType(type);
  relayState.lastSentAt[type] = Date.now();
}

async function processRelayQueues(client) {
  if (!client || relayState.sending) return;
  relayState.sending = true;
  try {
    await sendOneQueuedMedia(client, "gifs");
    await sendOneQueuedMedia(client, "avatar");
    await sendOneQueuedMedia(client, "banners");
  } finally {
    relayState.sending = false;
  }
}

async function pollSourceChannels(client) {
  const sourceChannelIds = [
    ...new Set(
      getSourceEntries()
        .flatMap((e) => [e.idCanalGifs, e.idCanalAvatar, e.idCanalBanners])
        .filter(Boolean)
    )
  ];

  for (const channelId of sourceChannelIds) {
    const channel =
      client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
    if (!channel || typeof channel.messages?.fetch !== "function") continue;

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (!messages) continue;

    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const message of sorted) {
      await forwardSourceMessage(message).catch(() => {});
    }
  }
}

function startSourceRelayPolling(client) {
  relayClient = client;

  if (!pollRef) {
    pollRef = setInterval(() => {
      pollSourceChannels(client).catch(() => {});
    }, POLL_INTERVAL_MS);
    if (typeof pollRef.unref === "function") pollRef.unref();
  }

  if (!queueRef) {
    queueRef = setInterval(() => {
      processRelayQueues(client).catch(() => {});
    }, QUEUE_TICK_MS);
    if (typeof queueRef.unref === "function") queueRef.unref();
  }

  pollSourceChannels(client).catch(() => {});
  processRelayQueues(client).catch(() => {});
}

module.exports = {
  forwardSourceMessage,
  startSourceRelayPolling
};
