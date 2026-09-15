/**
 * Puppeteer Wrapper with Concurrency Control
 *
 * Provides high-level functions for browser automation tasks:
 * screenshots, PDF generation, page scraping, and HTML rendering.
 *
 * Requires: puppeteer (npm install puppeteer).
 *
 * File handling pattern (same as FFmpeg/yt-dlp):
 *   - Uses fileTtl.register() for auto-cleanup temp files
 *   - Uses buildDownloadUrl() for download URLs
 *   - Returns { filename, downloadUrl, size } — same as ytdl.js
 *
 * Usage:
 *   const puppeteer = require('./puppeteer');
 *
 *   // Screenshot → returns { filename, downloadUrl, size, width, height }
 *   const result = await puppeteer.screenshot(url, '/tmp/screenshot.png', { width: 1280 });
 *
 *   // PDF → returns { filename, downloadUrl, size, pages }
 *   const pdf = await puppeteer.toPdf(url, '/tmp/page.pdf', { format: 'A4' });
 *
 *   // Extract content → returns { title, content, meta } (no file)
 *   const data = await puppeteer.getContent(url, { selector: 'body' });
 *
 *   // Render HTML → returns { filename, downloadUrl, size }
 *   const render = await puppeteer.renderHtml(html, '/tmp/render.png');
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { createLimiter } = require('./concurrency');
const fileTtl = require('./fileTtl');

// Puppeteer is heavy — default to 2 concurrent browsers
let limiter = createLimiter(parseInt(process.env.SCRIPT_PUPPETEER_CONCURRENCY) || 2, {
  timeout: parseInt(process.env.SCRIPT_PUPPETEER_TIMEOUT) || 120_000 // 2 min default
});

let tempDir = path.join(__dirname, '..', 'temp');
try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch {}

/**
 * Shared browser instance pool (reduces startup overhead)
 */
const browserPool = {
  _browser: null,
  _launching: null,
  _lastUsed: 0,
  _idleTimeout: 60_000, // Close browser after 60s idle

  async get() {
    // Clean up idle browser
    if (this._browser && (Date.now() - this._lastUsed > this._idleTimeout)) {
      try { await this._browser.close(); } catch {}
      this._browser = null;
    }

    if (this._browser) {
      this._lastUsed = Date.now();
      return this._browser;
    }

    // Prevent multiple simultaneous launches
    if (this._launching) return this._launching;

    this._launching = this._launch();
    const browser = await this._launching;
    this._launching = null;
    return browser;
  },

  async _launch() {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      ...(process.env.PUPPETEER_ARGS ? process.env.PUPPETEER_ARGS.split(',') : [])
    ];

    const browser = await puppeteer.launch({
      headless: 'new',
      args,
      defaultViewport: { width: 1280, height: 720 },
      timeout: 30_000
    });

    this._browser = browser;
    this._lastUsed = Date.now();

    // Auto-close on disconnect
    browser.on('disconnected', () => { this._browser = null; });

    return browser;
  },

  async close() {
    if (this._browser) {
      try { await this._browser.close(); } catch {}
      this._browser = null;
    }
  }
};

/**
 * Build a public download URL for a temp file
 */
function buildDownloadUrl(filename) {
  const base = (process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const safe = fileTtl.sanitizeFilename(filename);
  return `${base}/gateway/download/${encodeURIComponent(safe)}`;
}

/**
 * Check if Puppeteer is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    const browser = await browserPool.get();
    if (!browser) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Set concurrency limit
 * @param {number} n
 */
function setConcurrency(n) {
  limiter = createLimiter(n, { timeout: limiter._timeout });
}

/**
 * Set timeout per task
 * @param {number} ms
 */
function setTimeout(ms) {
  limiter = createLimiter(limiter.limit, { timeout: ms });
}

/**
 * Close the shared browser instance
 */
async function closeBrowser() {
  await browserPool.close();
}

/**
 * Take a screenshot of a URL
 * @param {string} url - URL to screenshot
 * @param {string} [outputPath] - Output file path (optional, auto-generated if not provided)
 * @param {object} [opts]
 * @param {number} [opts.width=1280] - Viewport width
 * @param {number} [opts.height=720] - Viewport height
 * @param {boolean} [opts.fullPage=false] - Capture full scrollable page
 * @param {string} [opts.format='png'] - Output format: 'png' | 'jpeg' | 'webp'
 * @param {number} [opts.quality=80] - JPEG/WebP quality (1-100)
 * @param {string} [opts.selector] - CSS selector to screenshot specific element
 * @param {number} [opts.delay=0] - Wait delay in ms before screenshot (for JS rendering)
 * @param {string} [opts.userAgent] - Custom user agent
 * @param {number} [opts.navigateTimeout=30000] - Page navigation timeout
 * @returns {Promise<{success: boolean, path: string, filename: string, downloadUrl: string, size: number, width: number, height: number}>}
 */
async function screenshot(url, outputPath, opts = {}) {
  return limiter.add(async () => {
    const browser = await browserPool.get();
    const page = await browser.newPage();

    try {
      // Viewport
      const width = opts.width || 1280;
      const height = opts.height || 720;
      await page.setViewport({
        width,
        height,
        deviceScaleFactor: opts.deviceScaleFactor || 1
      });

      // User agent
      if (opts.userAgent) {
        await page.setUserAgent(opts.userAgent);
      }

      // Navigate
      await page.goto(url, {
        waitUntil: opts.waitUntil || 'networkidle2',
        timeout: opts.navigateTimeout || 30_000
      });

      // Wait for delay (allow JS to render)
      if (opts.delay > 0) {
        await new Promise(r => setTimeout(r, opts.delay));
      }

      // Wait for specific selector
      if (opts.selector) {
        await page.waitForSelector(opts.selector, { timeout: 10_000 });
      }

      // Screenshot options
      const format = opts.format || 'png';
      const ext = format === 'jpeg' ? 'jpg' : format;
      const outPath = outputPath || path.join(tempDir, `gw_puppeteer_${Date.now()}.${ext}`);

      const screenshotOpts = {
        path: outPath,
        type: format,
        fullPage: opts.fullPage || false
      };

      if (format !== 'png' && opts.quality) {
        screenshotOpts.quality = opts.quality;
      }

      // Element-only screenshot
      if (opts.selector) {
        const element = await page.$(opts.selector);
        if (element) {
          await element.screenshot(screenshotOpts);
        } else {
          throw new Error(`Element not found: ${opts.selector}`);
        }
      } else {
        await page.screenshot(screenshotOpts);
      }

      const stat = fs.statSync(outPath);
      const registered = fileTtl.register(outPath);

      return {
        success: true,
        path: registered.path,
        filename: registered.filename,
        downloadUrl: buildDownloadUrl(registered.filename),
        size: stat.size,
        width,
        height
      };
    } finally {
      await page.close();
    }
  });
}

/**
 * Generate PDF from a URL
 * @param {string} url - URL to convert
 * @param {string} [outputPath] - Output PDF path (optional, auto-generated if not provided)
 * @param {object} [opts]
 * @param {string} [opts.format='A4'] - Paper format: 'A4', 'Letter', 'Legal', etc.
 * @param {boolean} [opts.landscape=false] - Landscape orientation
 * @param {boolean} [opts.printBackground=true] - Include backgrounds
 * @param {number} [opts.scale=1] - Scale factor (0.1 - 2)
 * @param {object} [opts.margin] - Margins { top, right, bottom, left } in CSS units
 * @param {string} [opts.headerTemplate] - HTML header template
 * @param {string} [opts.footerTemplate] - HTML footer template
 * @param {number} [opts.delay=0] - Wait delay before generating PDF
 * @param {number} [opts.navigateTimeout=30000] - Page navigation timeout
 * @returns {Promise<{success: boolean, path: string, filename: string, downloadUrl: string, size: number, pages: number}>}
 */
async function toPdf(url, outputPath, opts = {}) {
  return limiter.add(async () => {
    const browser = await browserPool.get();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1280, height: 720 });

      await page.goto(url, {
        waitUntil: opts.waitUntil || 'networkidle2',
        timeout: opts.navigateTimeout || 30_000
      });

      if (opts.delay > 0) {
        await new Promise(r => setTimeout(r, opts.delay));
      }

      const outPath = outputPath || path.join(tempDir, `gw_puppeteer_${Date.now()}.pdf`);

      const pdfOpts = {
        path: outPath,
        format: opts.format || 'A4',
        landscape: opts.landscape || false,
        printBackground: opts.printBackground !== false,
        scale: opts.scale || 1,
        margin: opts.margin || { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        displayHeaderFooter: !!(opts.headerTemplate || opts.footerTemplate),
        headerTemplate: opts.headerTemplate || '',
        footerTemplate: opts.footerTemplate || ''
      };

      const pdfData = await page.pdf(pdfOpts);

      const stat = fs.statSync(outPath);
      const registered = fileTtl.register(outPath);

      // Estimate page count from PDF size (rough approximation)
      const pages = Math.max(1, Math.ceil(pdfData.length / 50000));

      return {
        success: true,
        path: registered.path,
        filename: registered.filename,
        downloadUrl: buildDownloadUrl(registered.filename),
        size: stat.size,
        pages
      };
    } finally {
      await page.close();
    }
  });
}

/**
 * Extract text/HTML content from a URL (no file output — returns data only)
 * @param {string} url - URL to scrape
 * @param {object} [opts]
 * @param {string} [opts.selector='body'] - CSS selector to extract
 * @param {string} [opts.format='text'] - Output format: 'text' | 'html' | 'json'
 * @param {string} [opts.userAgent] - Custom user agent
 * @param {number} [opts.delay=0] - Wait delay before extraction
 * @param {string[]} [opts.waitSelectors] - Wait for these selectors before extracting
 * @param {number} [opts.navigateTimeout=30000] - Page navigation timeout
 * @returns {Promise<{success: boolean, title: string, content: string|object, url: string, meta: object}>}
 */
async function getContent(url, opts = {}) {
  return limiter.add(async () => {
    const browser = await browserPool.get();
    const page = await browser.newPage();

    try {
      if (opts.userAgent) {
        await page.setUserAgent(opts.userAgent);
      }

      await page.goto(url, {
        waitUntil: opts.waitUntil || 'networkidle2',
        timeout: opts.navigateTimeout || 30_000
      });

      if (opts.delay > 0) {
        await new Promise(r => setTimeout(r, opts.delay));
      }

      // Wait for specific elements
      if (opts.waitSelectors) {
        for (const sel of opts.waitSelectors) {
          try { await page.waitForSelector(sel, { timeout: 5_000 }); } catch {}
        }
      }

      const title = await page.title();
      const selector = opts.selector || 'body';

      let content;
      if (opts.format === 'json') {
        content = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return {
            text: el.innerText,
            html: el.innerHTML,
            links: Array.from(el.querySelectorAll('a')).map(a => ({
              text: a.innerText.trim(),
              href: a.href
            })).filter(l => l.text && l.href).slice(0, 100),
            images: Array.from(el.querySelectorAll('img')).map(img => ({
              src: img.src,
              alt: img.alt,
              width: img.naturalWidth,
              height: img.naturalHeight
            })).filter(i => i.src).slice(0, 50)
          };
        }, selector);
      } else if (opts.format === 'html') {
        content = await page.$eval(selector, el => el.innerHTML);
      } else {
        content = await page.$eval(selector, el => el.innerText);
      }

      // Get meta info
      const meta = await page.evaluate(() => {
        const getMeta = (name) => {
          const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return el ? el.getAttribute('content') : null;
        };
        return {
          description: getMeta('description') || getMeta('og:description'),
          image: getMeta('og:image'),
          author: getMeta('author'),
          keywords: getMeta('keywords')
        };
      });

      return {
        success: true,
        title,
        content,
        url,
        meta
      };
    } finally {
      await page.close();
    }
  });
}

/**
 * Render HTML string to screenshot
 * @param {string} html - HTML content to render
 * @param {string} [outputPath] - Output file path (optional, auto-generated if not provided)
 * @param {object} [opts]
 * @param {number} [opts.width=1280] - Viewport width
 * @param {number} [opts.height=720] - Viewport height
 * @param {string} [opts.format='png'] - Output format: 'png' | 'jpeg' | 'webp'
 * @param {number} [opts.quality=80] - JPEG/WebP quality
 * @param {boolean} [opts.fullPage=false] - Capture full page
 * @param {object} [opts.styles] - Inline CSS to inject
 * @returns {Promise<{success: boolean, path: string, filename: string, downloadUrl: string, size: number}>}
 */
async function renderHtml(html, outputPath, opts = {}) {
  return limiter.add(async () => {
    const browser = await browserPool.get();
    const page = await browser.newPage();

    try {
      const width = opts.width || 1280;
      const height = opts.height || 720;
      await page.setViewport({ width, height });

      // Set content
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10_000 });

      // Inject custom styles
      if (opts.styles) {
        await page.evaluate((styles) => {
          const style = document.createElement('style');
          style.textContent = Object.entries(styles).map(([sel, css]) => `${sel} { ${css} }`).join('\n');
          document.head.appendChild(style);
        }, opts.styles);
      }

      const format = opts.format || 'png';
      const ext = format === 'jpeg' ? 'jpg' : format;
      const outPath = outputPath || path.join(tempDir, `gw_render_${Date.now()}.${ext}`);

      const screenshotOpts = {
        path: outPath,
        type: format,
        fullPage: opts.fullPage || false
      };

      if (format !== 'png' && opts.quality) {
        screenshotOpts.quality = opts.quality;
      }

      await page.screenshot(screenshotOpts);

      const stat = fs.statSync(outPath);
      const registered = fileTtl.register(outPath);

      return {
        success: true,
        path: registered.path,
        filename: registered.filename,
        downloadUrl: buildDownloadUrl(registered.filename),
        size: stat.size
      };
    } finally {
      await page.close();
    }
  });
}

/**
 * Execute JavaScript in page context and return result (no file output)
 * @param {string} url - URL to load
 * @param {string|Function} script - JS code to execute (function gets serialized)
 * @param {object} [opts]
 * @param {object} [opts.args] - Arguments to pass to the script
 * @param {number} [opts.delay=0] - Wait delay before execution
 * @param {number} [opts.navigateTimeout=30000] - Page navigation timeout
 * @returns {Promise<{success: boolean, result: any, title: string, url: string}>}
 */
async function evaluate(url, script, opts = {}) {
  return limiter.add(async () => {
    const browser = await browserPool.get();
    const page = await browser.newPage();

    try {
      await page.goto(url, {
        waitUntil: opts.waitUntil || 'networkidle2',
        timeout: opts.navigateTimeout || 30_000
      });

      if (opts.delay > 0) {
        await new Promise(r => setTimeout(r, opts.delay));
      }

      const result = await page.evaluate(
        typeof script === 'function' ? script : new Function('opts', script),
        opts.args || {}
      );

      const title = await page.title();

      return {
        success: true,
        result,
        title,
        url
      };
    } finally {
      await page.close();
    }
  });
}

/**
 * Get current concurrency stats
 */
function stats() {
  return {
    running: limiter.running,
    queued: limiter.queued,
    limit: limiter.limit,
    available: limiter.limit - limiter.running,
    browserActive: !!browserPool._browser
  };
}

module.exports = {
  // Core (file-producing — uses fileTtl for auto-cleanup)
  screenshot,
  toPdf,
  renderHtml,

  // Core (data-only — no file)
  getContent,
  evaluate,

  // Browser management
  closeBrowser,

  // Config
  setConcurrency,
  setTimeout,
  stats,

  // Direct limiter access
  limiter
};
