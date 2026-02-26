const fs = require("node:fs");
const path = require("node:path");
const Discord = require("discord.js");

let rootConfig = {};
try {
  rootConfig = require(path.join(process.cwd(), "config.json"));
} catch {}

const tokenFilePath = path.join(__dirname, "Token.json");
const tokenConfig = fs.existsSync(tokenFilePath)
  ? JSON.parse(fs.readFileSync(tokenFilePath, "utf8"))
  : {};

const BOT_TOKEN =
  rootConfig.DISCORD_TOKEN ||
  rootConfig.token ||
  tokenConfig.Token ||
  tokenConfig.token ||
  "";

const API_BASE = "https://discord.com/api/v10";
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
const E = {};
let patchesApplied = false;

const EMOJI_NAME_ALIASES = {
  Config: "Engrenagem",
  config: "Engrenagem",
  voltar: "Voltar",
  Voltar: "Voltar",
  sucesso: "Certo",
  Sucesso: "Certo",
  erro: "Erro",
  Erro: "Erro",
  documento: "Papel",
  Documento: "Papel",
  Papel: "Papel",
  "1249234932492": "Escudo",
  "1443963426874593390": "Fields",
  "1453005905279979683": "Engrenagem",
  "1453006393090248846": "Papel",
  "1462208143760166932": "Certo",
  "1462208432441393305": "Erro",
  "1473729853965471959": "Voltar",
  "1467595683212165180": "Spark",
  "1474455537570808013": "Pintor"
};

function readEmojiFolder() {
  const folder = path.join(process.cwd(), "emojis");
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
}

function normalizeEmojiName(fileName, ext) {
  return path
    .basename(fileName, ext)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function mentionFrom(name, id, animated) {
  return animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
}

function extractId(mention) {
  const match = String(mention).match(/(\d+)/);
  return match ? match[1] : null;
}

function parseCustomEmojiMention(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^<(a?):([^:>]+):(\d+)>$/);
  if (!match) return null;

  return {
    animated: match[1] === "a",
    name: match[2],
    id: match[3],
    mention: value
  };
}

function getEmojiMentionByName(name) {
  if (!name) return null;

  const raw = String(name);
  const alias = EMOJI_NAME_ALIASES[raw] || EMOJI_NAME_ALIASES[raw.toLowerCase()];
  if (alias && typeof E[alias] === "string") return E[alias];

  if (typeof E[raw] === "string") return E[raw];

  const lower = raw.toLowerCase();
  for (const [key, mention] of Object.entries(E)) {
    if (key.toLowerCase() === lower) return mention;
  }

  if (alias) {
    const aliasLower = String(alias).toLowerCase();
    for (const [key, mention] of Object.entries(E)) {
      if (key.toLowerCase() === aliasLower) return mention;
    }
  }

  return null;
}

function getCurrentEmojiMention(input) {
  if (!input) return null;

  if (typeof input === "string") {
    const parsed = parseCustomEmojiMention(input);
    if (parsed) return getEmojiMentionByName(parsed.name) || input;

    const byName = getEmojiMentionByName(input);
    return byName || input;
  }

  if (typeof input === "object" && input.name) {
    return getEmojiMentionByName(input.name) || null;
  }

  return null;
}

function emojiMentionToComponentValue(mentionOrName) {
  const mention = getCurrentEmojiMention(mentionOrName);
  if (!mention || typeof mention !== "string") return mentionOrName;

  const parsed = parseCustomEmojiMention(mention);
  if (!parsed) return mention;

  return {
    id: parsed.id,
    name: parsed.name,
    animated: parsed.animated
  };
}

function replaceEmojiMentionsInText(text) {
  if (typeof text !== "string") return text;

  return text.replace(/<a?:([^:>]+):(\d+)>/g, (full, name) => {
    return getEmojiMentionByName(name) || full;
  });
}

function convertEphemeralToFlags(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (value.ephemeral !== true) return;

  const ephemeralFlag = Number(Discord.MessageFlags?.Ephemeral || 64);
  const currentFlags = Number(value.flags || 0);
  value.flags = currentFlags | ephemeralFlag;
  delete value.ephemeral;
}

function normalizeDiscordPayload(value) {
  if (!value) return value;

  if (typeof value === "string") return replaceEmojiMentionsInText(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = normalizeDiscordPayload(value[i]);
    }
    return value;
  }

  if (typeof value === "object") {
    convertEphemeralToFlags(value);

    for (const field of ["content", "label", "description", "placeholder"]) {
      if (typeof value[field] === "string") {
        value[field] = replaceEmojiMentionsInText(value[field]);
      }
    }

    if (Array.isArray(value.components)) normalizeDiscordPayload(value.components);
    if (Array.isArray(value.embeds)) normalizeDiscordPayload(value.embeds);
    if (value.data && typeof value.data === "object") normalizeDiscordPayload(value.data);

    return value;
  }

  return value;
}

function wrapPrototypeMethod(proto, methodName, wrapper) {
  if (!proto || typeof proto[methodName] !== "function") return;
  const original = proto[methodName];
  if (original.__emojiPatched) return;

  function patched(...args) {
    return wrapper.call(this, original, args);
  }

  patched.__emojiPatched = true;
  proto[methodName] = patched;
}

function applyEmojiPatches() {
  if (patchesApplied) return;
  patchesApplied = true;

  const { TextDisplayBuilder, ButtonBuilder, StringSelectMenuOptionBuilder } = Discord;

  wrapPrototypeMethod(TextDisplayBuilder?.prototype, "setContent", function (original, args) {
    if (typeof args[0] === "string") args[0] = replaceEmojiMentionsInText(args[0]);
    return original.apply(this, args);
  });

  wrapPrototypeMethod(ButtonBuilder?.prototype, "setEmoji", function (original, args) {
    if (args.length > 0) args[0] = emojiMentionToComponentValue(args[0]);
    return original.apply(this, args);
  });

  wrapPrototypeMethod(
    StringSelectMenuOptionBuilder?.prototype,
    "setEmoji",
    function (original, args) {
      if (args.length > 0) args[0] = emojiMentionToComponentValue(args[0]);
      return original.apply(this, args);
    }
  );

  const interactionClasses = [
    Discord.ChatInputCommandInteraction,
    Discord.ButtonInteraction,
    Discord.StringSelectMenuInteraction,
    Discord.ModalSubmitInteraction
  ];

  for (const Cls of interactionClasses) {
    if (!Cls?.prototype) continue;

    for (const methodName of ["reply", "followUp", "editReply", "update"]) {
      wrapPrototypeMethod(Cls.prototype, methodName, function (original, args) {
        if (args[0] && typeof args[0] === "object") {
          args[0] = normalizeDiscordPayload(args[0]);
        } else if (typeof args[0] === "string") {
          args[0] = replaceEmojiMentionsInText(args[0]);
        }
        return original.apply(this, args);
      });
    }
  }

  const sendOwners = [
    Discord.BaseGuildTextChannel?.prototype,
    Discord.ThreadChannel?.prototype,
    Discord.Webhook?.prototype,
    Discord.InteractionWebhook?.prototype,
    Discord.DMChannel?.prototype
  ];

  for (const proto of sendOwners) {
    wrapPrototypeMethod(proto, "send", function (original, args) {
      if (args[0] && typeof args[0] === "object") {
        args[0] = normalizeDiscordPayload(args[0]);
      } else if (typeof args[0] === "string") {
        args[0] = replaceEmojiMentionsInText(args[0]);
      }
      return original.apply(this, args);
    });
  }
}

async function apiRequest(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    let apiMessage = "";
    try {
      const errBody = await res.json();
      apiMessage = errBody?.message ? ` - ${errBody.message}` : "";
    } catch {}
    throw new Error(`Discord API ${res.status} em ${endpoint}${apiMessage}`);
  }

  if (res.status === 204) return null;

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function publishGlobals() {
  for (const [name, mention] of Object.entries(E)) {
    global[name] = mention;
  }

  global.getAppEmoji = getCurrentEmojiMention;
  global.fixAppEmojis = replaceEmojiMentionsInText;
}

async function UploadEmojis(client) {
  if (!BOT_TOKEN) {
    console.warn("[EMOJIS] Token ausente em config.json (DISCORD_TOKEN) / Token.json.");
    return;
  }

  try {
    if (!client?.application) {
      await client.fetchApplication();
    } else {
      await client.application.fetch();
    }
  } catch (error) {
  }

  if (!client?.application?.id) {
    return;
  }

  for (const key of Object.keys(E)) delete E[key];

  let remoteItems = [];
  try {
    const data = await apiRequest(`/applications/${client.application.id}/emojis`, {
      method: "GET"
    });

    remoteItems = data?.items || [];
    for (const emoji of remoteItems) {
      if (emoji?.name && emoji?.id) {
        E[emoji.name] = mentionFrom(emoji.name, emoji.id, Boolean(emoji.animated));
      }
    }
  } catch (error) {
  }

  const emojiFolder = readEmojiFolder();

  const dirFiles = fs.readdirSync(emojiFolder);
  const imageFiles = dirFiles.filter((fileName) =>
    IMAGE_EXTS.has(path.extname(fileName).toLowerCase())
  );

  const localNames = new Set();
  let created = 0;
  let removed = 0;
  let skippedInvalid = 0;
  let failed = 0;

  for (const fileName of imageFiles) {
    const ext = path.extname(fileName).toLowerCase();

    const name = normalizeEmojiName(fileName, ext);
    if (!name || name.length < 2) {
      skippedInvalid++;
      continue;
    }

    const isGif = ext === ".gif";
    const filePath = path.join(emojiFolder, fileName);
    localNames.add(name);

    try {
      const fileData = fs.readFileSync(filePath);
      const mimeExt = ext === ".jpg" ? "jpeg" : ext.slice(1);
      const base64 = `data:image/${mimeExt};base64,${fileData.toString("base64")}`;

      if (E[name]) {
        const emojiId = extractId(E[name]);
        if (emojiId) {
          await apiRequest(`/applications/${client.application.id}/emojis/${emojiId}`, {
            method: "DELETE"
          });
          delete E[name];
        }
      }

      const createdEmoji = await apiRequest(`/applications/${client.application.id}/emojis`, {
        method: "POST",
        body: JSON.stringify({ name, image: base64 })
      });

      if (createdEmoji?.name && createdEmoji?.id) {
        E[createdEmoji.name] = mentionFrom(
          createdEmoji.name,
          createdEmoji.id,
          Boolean(createdEmoji.animated ?? isGif)
        );
        created++;
      }
    } catch (error) {
      failed++;
    }
  }

  for (const remote of remoteItems) {
    if (!remote?.name || !remote?.id) continue;
    if (localNames.has(remote.name)) continue;

    try {
      await apiRequest(`/applications/${client.application.id}/emojis/${remote.id}`, {
        method: "DELETE"
      });
      delete E[remote.name];
      removed++;
    } catch (error) {
      failed++;
    }
  }

  publishGlobals();
}

async function initEmojiSystem(client) {
  applyEmojiPatches();
  await UploadEmojis(client);
}

async function syncEmojisOnGuildJoin(_guild, client) {
  await UploadEmojis(client);
}

module.exports = {
  UploadEmojis,
  initEmojiSystem,
  syncEmojisOnGuildJoin,
  replaceEmojiMentionsInText,
  getCurrentEmojiMention,
  normalizeDiscordPayload,
  E,
  syncApplicationEmojis: UploadEmojis
};
