const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const { AttachmentBuilder } = require("discord.js");

const execFileAsync = promisify(execFile);
const BG = { r: 10, g: 10, b: 18, alpha: 1 };

const PRESETS = {
  gifs: { width: 768, height: 768, fit: "contain", bgHex: "0A0A12" },
  avatar: { width: 1024, height: 1024, fit: "cover", output: "png", position: "centre" },
  banners: { width: 1200, height: 480, fit: "cover", output: "jpg", quality: 90, bgHex: "0A0A12" }
};

let sharpLib = null;
let ffmpegAvailablePromise = null;

try {
  sharpLib = require("sharp");
} catch {}

function isGifBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
  const sig = buffer.subarray(0, 6).toString("ascii");
  return sig === "GIF87a" || sig === "GIF89a";
}

function inferExtension(url, contentType, buffer) {
  const lowerUrl = String(url || "").toLowerCase();
  const type = String(contentType || "").toLowerCase();

  if (isGifBuffer(buffer) || type.includes("gif") || /\.gif(\?|$)/.test(lowerUrl)) return "gif";
  if (type.includes("png") || /\.png(\?|$)/.test(lowerUrl)) return "png";
  if (type.includes("webp") || /\.webp(\?|$)/.test(lowerUrl)) return "webp";
  if (type.includes("avif") || /\.avif(\?|$)/.test(lowerUrl)) return "avif";
  if (type.includes("jpeg") || type.includes("jpg") || /\.jpe?g(\?|$)/.test(lowerUrl)) return "jpg";
  return "bin";
}

async function downloadMedia(url) {
  const res = await fetch(String(url), {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Random-GIF-Bot/1.0" }
  });

  if (!res.ok) throw new Error(`Falha no download (${res.status})`);

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || ""
  };
}

async function ensureFfmpegAvailable() {
  if (!ffmpegAvailablePromise) {
    ffmpegAvailablePromise = execFileAsync("ffmpeg", ["-version"], { windowsHide: true })
      .then(() => true)
      .catch(() => false);
  }
  return ffmpegAvailablePromise;
}

async function normalizeStatic(buffer, kind) {
  if (!sharpLib) return null;
  const preset = PRESETS[kind] || PRESETS.avatar;

  let pipeline = sharpLib(buffer)
    .rotate()
    .resize(preset.width, preset.height, {
      fit: preset.fit,
      position: preset.position || "centre",
      background: BG,
      withoutEnlargement: false
    });

  if (preset.output === "jpg") {
    pipeline = pipeline.flatten({ background: BG }).jpeg({ quality: preset.quality || 88, mozjpeg: true });
    return { buffer: await pipeline.toBuffer(), fileName: "midia.jpg" };
  }

  pipeline = pipeline.png({ compressionLevel: 9 });
  return { buffer: await pipeline.toBuffer(), fileName: "midia.png" };
}

async function normalizeGifWithSharp(buffer, kind) {
  if (!sharpLib) return null;
  const preset = PRESETS[kind] || PRESETS.gifs;

  try {
    const out = await sharpLib(buffer, { animated: true })
      .resize(preset.width, preset.height, {
        fit: preset.fit || "contain",
        position: preset.position || "centre",
        background: BG,
        withoutEnlargement: false
      })
      .gif({ effort: 7, dither: 1 })
      .toBuffer();

    return { buffer: out, fileName: "midia.gif" };
  } catch {
    return null;
  }
}

function buildGifFfmpegFilter(preset) {
  const scale = preset.fit === "cover"
    ? `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase:flags=lanczos`
    : `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease:flags=lanczos`;

  const second = preset.fit === "cover"
    ? `crop=${preset.width}:${preset.height}`
    : `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:color=${preset.bgHex || "0A0A12"}`;

  return [scale, second].join(",");
}

async function normalizeGifWithFfmpeg(buffer, kind) {
  const hasFfmpeg = await ensureFfmpegAvailable();
  if (!hasFfmpeg) return null;

  const preset = PRESETS[kind] || PRESETS.gifs;
  const tempDir = path.join(os.tmpdir(), `rgbot-${randomUUID()}`);
  const inPath = path.join(tempDir, "in.gif");
  const outPath = path.join(tempDir, "out.gif");

  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(inPath, buffer);

  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inPath, "-vf", buildGifFfmpegFilter(preset), "-gifflags", "+transdiff", outPath],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 * 4 }
    );
    return { buffer: await fs.readFile(outPath), fileName: "midia.gif" };
  } catch {
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function normalizeGif(buffer, kind) {
  return (await normalizeGifWithFfmpeg(buffer, kind)) || (await normalizeGifWithSharp(buffer, kind));
}

function emptyAsset(originalUrl) {
  return { displayUrl: originalUrl, downloadUrl: originalUrl, files: [], normalized: false };
}

function buildProcessedAsset(fileBuffer, fileName, originalUrl) {
  return {
    displayUrl: `attachment://${fileName}`,
    downloadUrl: originalUrl,
    files: [new AttachmentBuilder(fileBuffer, { name: fileName })],
    normalized: true
  };
}

async function prepareMediaAsset(mediaUrl, kind = "avatar") {
  const originalUrl = String(mediaUrl || "");
  if (!originalUrl) return emptyAsset("");

  try {
    const { buffer, contentType } = await downloadMedia(originalUrl);
    const ext = inferExtension(originalUrl, contentType, buffer);

    if (ext === "gif") {
      const normalizedGif = await normalizeGif(buffer, kind);
      if (!normalizedGif) return emptyAsset(originalUrl);
      return buildProcessedAsset(normalizedGif.buffer, normalizedGif.fileName, originalUrl);
    }

    if (["png", "jpg", "webp", "avif"].includes(ext)) {
      const normalized = await normalizeStatic(buffer, kind);
      if (!normalized) return emptyAsset(originalUrl);
      return buildProcessedAsset(normalized.buffer, normalized.fileName, originalUrl);
    }
  } catch {}

  return emptyAsset(originalUrl);
}

module.exports = {
  prepareMediaAsset
};
