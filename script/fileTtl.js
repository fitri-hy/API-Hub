const fs = require('fs');
const path = require('path');

/**
 * Auto-delete temp files after TTL (default 30s).
 * - register(filePath)       → starts 30s countdown
 * - registerText(content, filename) → write text to temp file + register
 * - cancel(filePath)         → clears countdown (user opened the download)
 * - destroy(filePath)        → immediate delete + cancel
 */
const timers = new Map();

const DEFAULT_TTL_MS = parseInt(process.env.FILE_TTL_MS) || 30000;

const TEMP_DIR = path.join(__dirname, '..', 'temp');
try { if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch {}

function register(filePath, ttlMs = DEFAULT_TTL_MS) {
  cancel(filePath);

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const safeName = sanitizeFilename(path.basename(filePath));
  const safePath = path.join(dir, safeName);
  if (filePath !== safePath) {
    try {
      if (fs.existsSync(safePath)) fs.unlinkSync(safePath);
      fs.renameSync(filePath, safePath);
    } catch { /* keep original name */ }
  }
  const finalPath = fs.existsSync(safePath) ? safePath : filePath;

  const timer = setTimeout(() => {
    timers.delete(finalPath);
    try { fs.unlinkSync(finalPath); } catch {}
  }, ttlMs);
  timers.set(finalPath, timer);

  const filename = path.basename(finalPath);
  const downloadUrl = buildDownloadUrl(filename);

  return { path: finalPath, filename, downloadUrl };
}

/**
 * Write text content to a temp file and register it.
 * @param {string} content - Text/string content (SVG, HTML, JSON, etc.)
 * @param {string} filename - Desired filename (e.g. 'qr.svg')
 * @param {number} [ttlMs] - TTL in ms
 * @returns {{ path, filename, downloadUrl }}
 */
function registerText(content, filename, ttlMs) {
  const safeName = sanitizeFilename(filename);
  const filePath = path.join(TEMP_DIR, safeName);
  fs.writeFileSync(filePath, content, 'utf8');
  return register(filePath, ttlMs);
}

function cancel(filePath) {
  const t = timers.get(filePath);
  if (t) {
    clearTimeout(t);
    timers.delete(filePath);
  }
}

function destroy(filePath) {
  cancel(filePath);
  try { fs.unlinkSync(filePath); } catch {}
}

function sanitizeFilename(name) {
  return name
    .replace(/[\s]+/g, '_')
    .replace(/[<>:"\/\\|?*]/g, '')
    .replace(/[—–·\u2018\u2019\u201C\u201D]/g, '')
    .replace(/[^\w._-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/\.\./g, '.');
}

function buildDownloadUrl(filename) {
  const base = (process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const safe = sanitizeFilename(filename);
  return base + '/gateway/download/' + encodeURIComponent(safe);
}

module.exports = { register, registerText, cancel, destroy, sanitizeFilename, buildDownloadUrl };
