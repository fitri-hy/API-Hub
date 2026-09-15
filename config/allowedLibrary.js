/**
 * Centralized allowed libraries for sandboxed handler execution.
 * Used by gatewayController.js and playgroundController.js.
 *
 * ESM modules are pre-loaded at startup (via loadEsm()) and cached
 * so handler code can use `import('cheerio')` inside the VM sandbox
 * without needing --experimental-vm-modules.
 */

// ── CJS modules (require) ──────────────────────────────────────
const allowedInternal = {
  'script': require('../script'),
  'script/concurrency': require('../script/concurrency'),
  'script/ffmpeg': require('../script/ffmpeg'),
  'script/ytdl': require('../script/ytdl'),
  'script/puppeteer': require('../script/puppeteer'),
  'script/fileTtl': require('../script/fileTtl'),
  'qrcode': require('qrcode'),
  'canvas': require('canvas'),
  'jsqr': require('jsqr'),
  'sharp': require('sharp'),
};

const allowedCjs = {
  'uuid': 'uuid',
  'bcryptjs': 'bcryptjs',
  'crypto': 'crypto',
  'querystring': 'querystring',
  'url': 'url',
  'path': 'path',
  'axios': 'axios',
};

// ── ESM modules (import) ───────────────────────────────────────
const allowedEsm = [
  'node-fetch', 'axios', 'cheerio', 'dayjs', 'moment',
  'lodash', 'ramda', 'mathjs', 'currency.js',
  'fast-xml-parser', 'xml2js', 'he', 'uuid', 'bcryptjs',
  'dotenv', 'form-data', 'querystring',
];

// ── Pre-loaded ESM cache ────────────────────────────────────────
const esmCache = {};
let esmLoaded = false;

async function loadEsm() {
  if (esmLoaded) return esmCache;

  await Promise.allSettled(
    allowedEsm.map(async (name) => {
      try {
        const mod = await import(name);
        esmCache[name] = mod.default || mod;
      } catch {
        // Module not installed — skip silently
      }
    })
  );

  esmLoaded = true;
  return esmCache;
}

function getEsm() {
  return esmCache;
}

module.exports = {
  allowedInternal,
  allowedCjs,
  allowedEsm,
  loadEsm,
  getEsm,
};
