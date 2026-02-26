function normalizeMediaKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function extractComponentUrls(components, out) {
  if (!Array.isArray(components)) return;

  for (const row of components) {
    const inner = row?.components;
    if (!Array.isArray(inner)) continue;

    for (const comp of inner) {
      if (typeof comp?.url === "string") out.push(comp.url);
      if (Array.isArray(comp?.components)) extractComponentUrls(comp.components, out);
    }
  }
}

async function channelHasEquivalentMedia(channel, mediaUrl, limit = 50) {
  if (!channel || typeof channel.messages?.fetch !== "function") return false;

  const target = normalizeMediaKey(mediaUrl);
  if (!target) return false;

  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages) return false;

  for (const msg of messages.values()) {
    if (typeof msg.content === "string" && normalizeMediaKey(msg.content) === target) {
      return true;
    }

    for (const att of msg.attachments.values()) {
      if (normalizeMediaKey(att.url) === target || normalizeMediaKey(att.proxyURL) === target) {
        return true;
      }
    }

    for (const embed of msg.embeds || []) {
      const urls = [embed?.url, embed?.image?.url, embed?.thumbnail?.url, embed?.video?.url].filter(Boolean);
      if (urls.some((u) => normalizeMediaKey(u) === target)) return true;
    }

    const componentUrls = [];
    extractComponentUrls(msg.components, componentUrls);
    if (componentUrls.some((u) => normalizeMediaKey(u) === target)) return true;
  }

  return false;
}

module.exports = {
  channelHasEquivalentMedia,
  normalizeMediaKey
};
