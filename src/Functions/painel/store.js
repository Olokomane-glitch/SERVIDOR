const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dataDir = path.join(process.cwd(), "data");
const sqliteFile = path.join(dataDir, "bot.sqlite");
const historySqliteFile = path.join(dataDir, "history.sqlite");
const legacyJsonFile = path.join(dataDir, "painel-config.json");
const rootConfigFile = path.join(process.cwd(), "config.json");

const DEFAULT_CONFIG = {
  canais: {
    gifs: null,
    avatar: null,
    banners: null
  },
  sistemas: {
    gifs: { ligado: false, tempoSegundos: 60 },
    avatar: { ligado: false, tempoSegundos: 60 },
    banners: { ligado: false, tempoSegundos: 60 }
  },
  servidoresOrigens: []
};

const TIPOS = ["gifs", "avatar", "banners"];
let db = null;
let historyDb = null;

function normalizeSistemaConfig(base, incoming) {
  const merged = { ...base, ...(incoming || {}) };
  if (
    (merged.tempoSegundos === undefined || merged.tempoSegundos === null) &&
    Number.isFinite(merged.tempoMinutos)
  ) {
    merged.tempoSegundos = merged.tempoMinutos * 60;
  }
  delete merged.tempoMinutos;
  merged.tempoSegundos = Math.max(1, Number(merged.tempoSegundos || base.tempoSegundos || 60));
  merged.ligado = merged.ligado === true;
  return merged;
}

function normalizeServidorOrigem(item) {
  if (!item || typeof item !== "object") return null;
  const normalized = {
    idServidor: String(item.idServidor || item.guildId || "").trim(),
    idCanalGifs: String(item.idCanalGifs || item.gifs || "").trim(),
    idCanalAvatar: String(item.idCanalAvatar || item.avatar || "").trim(),
    idCanalBanners: String(item.idCanalBanners || item.banners || "").trim(),
    ligado: item.ligado !== false
  };
  if (!normalized.idServidor) return null;
  return normalized;
}

function mergeDefaults(input) {
  const cfg = input && typeof input === "object" ? input : {};
  return {
    canais: {
      ...DEFAULT_CONFIG.canais,
      ...(cfg.canais || {})
    },
    sistemas: {
      gifs: normalizeSistemaConfig(DEFAULT_CONFIG.sistemas.gifs, cfg.sistemas?.gifs),
      avatar: normalizeSistemaConfig(DEFAULT_CONFIG.sistemas.avatar, cfg.sistemas?.avatar),
      banners: normalizeSistemaConfig(DEFAULT_CONFIG.sistemas.banners, cfg.sistemas?.banners)
    },
    servidoresOrigens: Array.isArray(cfg.servidoresOrigens)
      ? cfg.servidoresOrigens.map(normalizeServidorOrigem).filter(Boolean)
      : []
  };
}

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function getDb() {
  if (db) return db;

  ensureDataDir();
  db = new Database(sqliteFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS painel_channels (
      tipo TEXT PRIMARY KEY,
      channel_id TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS painel_systems (
      tipo TEXT PRIMARY KEY,
      ligado INTEGER NOT NULL DEFAULT 0,
      tempo_segundos INTEGER NOT NULL DEFAULT 60
    );

    CREATE TABLE IF NOT EXISTS media_source_servers (
      id_servidor TEXT PRIMARY KEY,
      id_canal_gifs TEXT NOT NULL DEFAULT '',
      id_canal_avatar TEXT NOT NULL DEFAULT '',
      id_canal_banners TEXT NOT NULL DEFAULT '',
      ligado INTEGER NOT NULL DEFAULT 1
    );
  `);

  seedDefaults();
  migrateLegacyJsonIfNeeded();
  migrateLegacyConfigKeysIfPresent();
  return db;
}

function getHistoryDb() {
  if (historyDb) return historyDb;

  ensureDataDir();
  historyDb = new Database(historySqliteFile);
  historyDb.pragma("journal_mode = WAL");

  historyDb.exec(`
    CREATE TABLE IF NOT EXISTS sent_media_history (
      tipo TEXT NOT NULL,
      media_url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (tipo, media_url)
    );
  `);

  return historyDb;
}

function seedDefaults() {
  const database = db;
  const insertChannel = database.prepare(
    "INSERT OR IGNORE INTO painel_channels (tipo, channel_id) VALUES (?, NULL)"
  );
  const insertSystem = database.prepare(
    "INSERT OR IGNORE INTO painel_systems (tipo, ligado, tempo_segundos) VALUES (?, ?, ?)"
  );

  for (const tipo of TIPOS) {
    insertChannel.run(tipo);
    insertSystem.run(tipo, 0, 60);
  }
}

function tableHasData(tableName) {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get();
  return Number(row?.total || 0) > 0;
}

function migrateLegacyJsonIfNeeded() {
  if (!fs.existsSync(legacyJsonFile)) return;

  const hasChannels = tableHasData("painel_channels");
  const hasSystems = tableHasData("painel_systems");
  const hasSources = tableHasData("media_source_servers");

  if (hasChannels && hasSystems && hasSources) return;

  try {
    const raw = fs.readFileSync(legacyJsonFile, "utf8");
    const parsed = mergeDefaults(JSON.parse(raw));
    writePainelConfig(parsed);
  } catch {}
}

function migrateLegacyConfigKeysIfPresent() {
  if (!fs.existsSync(rootConfigFile)) return;

  try {
    const cfg = JSON.parse(fs.readFileSync(rootConfigFile, "utf8"));
    const legacy = normalizeServidorOrigem({
      idServidor: cfg.ID_SERVIDOR_ORIGEM_MIDIAS,
      idCanalGifs: cfg.ID_CANAL_ORIGEM_GIFS,
      idCanalAvatar: cfg.ID_CANAL_ORIGEM_AVATAR,
      idCanalBanners: cfg.ID_CANAL_ORIGEM_BANNERS,
      ligado: true
    });

    if (!legacy) return;

    const exists = db.prepare(
      "SELECT 1 FROM media_source_servers WHERE id_servidor = ? LIMIT 1"
    ).get(legacy.idServidor);

    if (exists) return;

    db.prepare(`
      INSERT INTO media_source_servers (
        id_servidor, id_canal_gifs, id_canal_avatar, id_canal_banners, ligado
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      legacy.idServidor,
      legacy.idCanalGifs,
      legacy.idCanalAvatar,
      legacy.idCanalBanners,
      legacy.ligado ? 1 : 0
    );
  } catch {}
}

function readPainelConfig() {
  const database = getDb();

  const canaisRows = database.prepare(
    "SELECT tipo, channel_id FROM painel_channels"
  ).all();
  const sistemasRows = database.prepare(
    "SELECT tipo, ligado, tempo_segundos FROM painel_systems"
  ).all();
  const fontesRows = database.prepare(
    `SELECT id_servidor, id_canal_gifs, id_canal_avatar, id_canal_banners, ligado
     FROM media_source_servers
     ORDER BY rowid ASC`
  ).all();

  const cfg = mergeDefaults(null);

  for (const row of canaisRows) {
    if (TIPOS.includes(row.tipo)) cfg.canais[row.tipo] = row.channel_id || null;
  }

  for (const row of sistemasRows) {
    if (!TIPOS.includes(row.tipo)) continue;
    cfg.sistemas[row.tipo] = normalizeSistemaConfig(DEFAULT_CONFIG.sistemas[row.tipo], {
      ligado: Boolean(row.ligado),
      tempoSegundos: Number(row.tempo_segundos || 60)
    });
  }

  cfg.servidoresOrigens = fontesRows
    .map((row) => normalizeServidorOrigem({
      idServidor: row.id_servidor,
      idCanalGifs: row.id_canal_gifs,
      idCanalAvatar: row.id_canal_avatar,
      idCanalBanners: row.id_canal_banners,
      ligado: Boolean(row.ligado)
    }))
    .filter(Boolean);

  return cfg;
}

function writePainelConfig(nextConfig) {
  const database = getDb();
  const safe = mergeDefaults(nextConfig);

  const tx = database.transaction((cfg) => {
    const upsertChannel = database.prepare(`
      INSERT INTO painel_channels (tipo, channel_id)
      VALUES (?, ?)
      ON CONFLICT(tipo) DO UPDATE SET channel_id = excluded.channel_id
    `);

    const upsertSystem = database.prepare(`
      INSERT INTO painel_systems (tipo, ligado, tempo_segundos)
      VALUES (?, ?, ?)
      ON CONFLICT(tipo) DO UPDATE SET
        ligado = excluded.ligado,
        tempo_segundos = excluded.tempo_segundos
    `);

    const clearSources = database.prepare("DELETE FROM media_source_servers");
    const insertSource = database.prepare(`
      INSERT INTO media_source_servers (
        id_servidor, id_canal_gifs, id_canal_avatar, id_canal_banners, ligado
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const tipo of TIPOS) {
      upsertChannel.run(tipo, cfg.canais[tipo] || null);
      upsertSystem.run(tipo, cfg.sistemas[tipo].ligado ? 1 : 0, cfg.sistemas[tipo].tempoSegundos);
    }

    clearSources.run();
    for (const srv of cfg.servidoresOrigens) {
      insertSource.run(
        srv.idServidor,
        srv.idCanalGifs || "",
        srv.idCanalAvatar || "",
        srv.idCanalBanners || "",
        srv.ligado ? 1 : 0
      );
    }
  });

  tx(safe);
  return safe;
}

function updatePainelConfig(updater) {
  const current = readPainelConfig();
  const next = updater(structuredCloneSafe(current));
  return writePainelConfig(next || current);
}

function hasSentMediaUrl(tipo, mediaUrl) {
  const database = getHistoryDb();
  const url = String(mediaUrl || "").trim();
  const type = String(tipo || "").trim();
  if (!type || !url) return false;

  const row = database.prepare(
    "SELECT 1 FROM sent_media_history WHERE tipo = ? AND media_url = ? LIMIT 1"
  ).get(type, url);

  return Boolean(row);
}

function markSentMediaUrl(tipo, mediaUrl) {
  const database = getHistoryDb();
  const url = String(mediaUrl || "").trim();
  const type = String(tipo || "").trim();
  if (!type || !url) return;

  database.prepare(`
    INSERT INTO sent_media_history (tipo, media_url, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(tipo, media_url) DO NOTHING
  `).run(type, url, Date.now());
}

function resetSentMediaHistory() {
  const database = getHistoryDb();
  database.prepare("DELETE FROM sent_media_history").run();
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  readPainelConfig,
  writePainelConfig,
  updatePainelConfig,
  hasSentMediaUrl,
  markSentMediaUrl,
  resetSentMediaHistory,
  DEFAULT_CONFIG
};
