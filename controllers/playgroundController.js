const vm = require('vm');
const { marked } = require('marked');
const Api = require('../models/Api');
const ApiRoute = require('../models/ApiRoute');
const PlaygroundSession = require('../models/PlaygroundSession');
const fileTtl = require('../script/fileTtl');
const { allowedInternal, allowedCjs, allowedEsm, getEsm } = require('../config/allowedLibrary');

const playgroundController = {
  async init(req, res) {
    try {
	  const ua = req.headers['user-agent'] || '';

	  const isBrowser = /\bMozilla\/5\.0\b/i.test(ua) && /(Chrome|Chromium|Firefox|Safari|Edg|OPR)\//i.test(ua);

	  if (!isBrowser) {
	    return res.status(403).json({
	  	  error: 'Browser required to access Playground'
	    });
	  }

      const ip = req.ip || req.connection.remoteAddress;
      const userId = req.session.userId;

      // create() handles everything: UPDATE existing or INSERT new (1 user = 1 session)
      const session = await PlaygroundSession.create(userId, ip);

      // Calculate remaining rate limit from DB state
      const rateCheck = await PlaygroundSession.checkRateLimit(session.id);

      const watermark = Buffer.from(`pg|${userId}|${session.id}`).toString('base64');

      res.json({
        success: true,
        session: {
          token: session.token,
          fingerprint: session.fingerprint,
          expiresAt: session.expires_at || session.expiresAt,
          watermark
        },
        rateLimit: {
          remaining: rateCheck.remaining,
          max: 20
        }
      });
    } catch (err) {
      console.error('Playground init error:', err);
      res.status(500).json({ error: 'Failed to initialize playground' });
    }
  },

  async status(req, res) {
    try {
      const { token, fingerprint } = req.headers;
      const ip = req.ip || req.connection.remoteAddress;

      if (!token || !fingerprint) {
        return res.status(401).json({ error: 'No session', code: 'NO_SESSION' });
      }

      const session = await PlaygroundSession.validate(token, fingerprint, ip);
      if (!session) {
        return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
      }

      const rateCheck = await PlaygroundSession.checkRateLimit(session.id);

      res.json({
        success: true,
        session: {
          expiresAt: session.expires_at || session.expiresAt
        },
        rateLimit: {
          remaining: rateCheck.remaining,
          max: 20
        }
      });
    } catch (err) {
      console.error('Playground status error:', err);
      res.status(500).json({ error: 'Failed to get status' });
    }
  },

  async execute(req, res) {
    const startTime = Date.now();

    try {
      const ua = req.headers['user-agent'] || '';
      if (!ua.includes('Mozilla')) {
        return res.status(403).json({ error: 'Browser required', code: 'NOT_BROWSER' });
      }

      const { token, fingerprint } = req.headers;
      const ip = req.ip || req.connection.remoteAddress;

      if (!token || !fingerprint) {
        return res.status(401).json({ error: 'Invalid playground session', code: 'NO_SESSION' });
      }

      const session = await PlaygroundSession.validate(token, fingerprint, ip);
      if (!session) {
        return res.status(401).json({ error: 'Session expired or invalid. Please refresh.', code: 'SESSION_EXPIRED' });
      }

      const rateCheck = await PlaygroundSession.checkRateLimit(session.id);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          error: `Rate limit exceeded. Try again in ${rateCheck.resetIn}s.`,
          code: 'RATE_LIMIT',
          retryAfter: rateCheck.resetIn
        });
      }

      // Re-read fresh request_count from DB for CAPTCHA check
      const freshSession = await PlaygroundSession.validate(token, fingerprint, ip);
      const currentCount = freshSession ? freshSession.request_count : session.request_count;

      if (currentCount >= 10 && !req.body.captchaToken) {
        // Generate CAPTCHA challenge
        const a = Math.floor(Math.random() * 10) + 1;
        const b = Math.floor(Math.random() * 10) + 1;
        const answer = a + b;
        const captchaToken = await PlaygroundSession.setCaptchaChallenge(session.id, answer);
        return res.status(429).json({
          error: 'Verification required after 10 requests',
          code: 'CAPTCHA_REQUIRED',
          requireCaptcha: true,
          captcha: {
            question: `${a} + ${b} = ?`,
            a: a,
            b: b,
            captchaToken: captchaToken
          }
        });
      }

      // Verify CAPTCHA if provided
      if (req.body.captchaToken && req.body.captchaAnswer !== undefined) {
        const captchaValid = await PlaygroundSession.verifyCaptcha(
          session.id, req.body.captchaToken, req.body.captchaAnswer
        );
        if (!captchaValid) {
          return res.status(429).json({
            error: 'Invalid captcha answer. Please try again.',
            code: 'CAPTCHA_INVALID',
            requireCaptcha: true
          });
        }
      }

      let { apiSlug, method, path, body, queryParams, headers } = req.body;
      body = body || null;

      // Handle FormData (multipart) - fields come as strings
      if (req.is('multipart/form-data')) {
        // Parse JSON fields that were sent as strings
        if (typeof headers === 'string') try { headers = JSON.parse(headers); } catch { headers = {}; }
        if (typeof queryParams === 'string') try { queryParams = JSON.parse(queryParams); } catch { queryParams = {}; }
        // Build body from text fields (exclude metadata fields)
        const excluded = ['apiSlug', 'method', 'path', 'headers', 'queryParams', 'captchaToken', 'captchaAnswer'];
        const formDataBody = {};
        for (const [key, val] of Object.entries(req.body)) {
          if (excluded.includes(key)) continue;
          formDataBody[key] = val;
        }
        body = Object.keys(formDataBody).length > 0 ? formDataBody : (body || {});
      }

      // Build file object for handler (matches gateway format)
      const fileObj = req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        encoding: req.file.encoding,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer
      } : null;

      if (!apiSlug || !method || !path) {
        return res.status(400).json({ error: 'apiSlug, method, and path are required' });
      }

      const api = await Api.findBySlug(apiSlug);
      if (!api) return res.status(404).json({ error: `API "${apiSlug}" not found` });
      if (api.status !== 'active') return res.status(503).json({ error: 'API is currently unavailable' });

      const route = await ApiRoute.findByEndpoint(apiSlug, method.toUpperCase(), path);
      if (!route) return res.status(404).json({ error: `No ${method.toUpperCase()} route for ${path}` });

      let responseBody;
      let responseStatus = 200;
      let isSuccess = true;

      try {
        // For GET requests, merge body into query (handlers read from req.query)
        const mergedQuery = Object.assign({}, queryParams || {});
        if (method.toUpperCase() === 'GET' && body && typeof body === 'object') {
          for (const [k, v] of Object.entries(body)) {
            if (!mergedQuery[k]) mergedQuery[k] = v;
          }
        }

        const handlerResult = await executeHandler(route.handler_code, {
          req: {
            method: method.toUpperCase(),
            path: path,
            query: mergedQuery,
            body: body || {},
            headers: headers || {},
            params: { slug: apiSlug, '0': path.replace(/^\//, '') }
          },
          file: fileObj,
          user: { id: req.session.userId, username: req.session.username || 'playground_user' },
          api: { id: api.id, slug: api.slug, name: api.name },
          helpers: require('../utils/helpers'),
          db: require('../config/database')
        });

        if (handlerResult && typeof handlerResult.status === 'number') {
          responseStatus = handlerResult.status;
          responseBody = handlerResult.body || handlerResult.data || handlerResult;
          isSuccess = responseStatus >= 200 && responseStatus < 400;
        } else {
          responseBody = handlerResult;
        }
      } catch (execError) {
        responseStatus = 500;
        responseBody = { error: 'Handler execution failed', message: execError.message };
        isSuccess = false;
      }

      const responseTime = Date.now() - startTime;

      // Increment rate limit counter only on successful request
      if (isSuccess) {
        await PlaygroundSession.incrementRateLimit(session.id);
        rateCheck.remaining = Math.max(0, rateCheck.remaining - 1);
      }

      const watermark = Buffer.from(`pg|${req.session.userId}|${session.id}|${Date.now()}`).toString('base64');

      res.set('X-Playground', 'true');
      res.set('X-Response-Time', `${responseTime}ms`);
      res.set('X-RateLimit-Remaining', String(rateCheck.remaining));

      return res.status(responseStatus).json({
        success: isSuccess,
        data: responseBody,
        meta: {
          responseTime: `${responseTime}ms`,
          creditsUsed: 0,
          playground: true,
          watermark
        }
      });
    } catch (err) {
      console.error('Playground execute error:', err);
      return res.status(500).json({ error: 'Playground internal error' });
    }
  },

  async honeypot(req, res) {
    try {
      const { token, fingerprint } = req.headers;
      const ip = req.ip || req.connection.remoteAddress;

      if (token && fingerprint) {
        const session = await PlaygroundSession.validate(token, fingerprint, ip);
        if (session) {
          const banned = await PlaygroundSession.recordHoneypot(session.id);
          if (banned) console.log(`[HONEYPOT] User ${session.user_id} banned from IP ${ip}`);
        }
      }

      await new Promise(r => setTimeout(r, 5000));
      return res.json({ success: true, data: { id: 999999, name: 'secret-admin-endpoint', internal_data: { _debug: true } } });
    } catch (err) {
      return res.json({ success: true, data: {} });
    }
  },

  async listApis(req, res) {
    try {
      const apis = await Api.findPublic();
      res.json({
        success: true,
        apis: apis.map(a => ({
          name: a.name,
          slug: a.slug,
          description: a.description,
          version: a.version,
          baseRoute: a.base_route,
          creditCost: a.credit_cost,
          routeCount: 0
        }))
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load APIs' });
    }
  },

  async getRoutes(req, res) {
    try {
      const { slug } = req.params;
      const api = await Api.findBySlug(slug);
      if (!api) return res.status(404).json({ error: 'API not found' });

      const routes = await ApiRoute.findActiveByApiId(api.id);
      res.json({
        success: true,
        api: { name: api.name, slug: api.slug, baseRoute: api.base_route, version: api.version, description: api.description, creditCost: api.credit_cost, authRequired: api.auth_required },
        routes: routes.map(r => ({
          id: r.id,
          method: r.method,
          path: r.path,
          description: r.description || '',
          documentation: r.documentation || '',
          requestSchema: r.request_schema || null,
          responseSchema: r.response_schema || null,
          sampleResponse: r.sample_response || null,
          documentationHtml: r.documentation ? marked.parse(r.documentation) : ''
        }))
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load routes' });
    }
  }
};

async function executeHandler(code, context) {


  const sandbox = {
    console: { log: (...a) => {}, error: (...a) => {}, warn: (...a) => {}, info: (...a) => {} },
    JSON, Math, Date, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, RegExp, Promise,
    Buffer, ArrayBuffer, SharedArrayBuffer, Map, Set, WeakMap, WeakSet,
    Error, TypeError, RangeError, SyntaxError, ReferenceError,
    setTimeout, setInterval, clearTimeout, clearInterval,
    fetch, URL, URLSearchParams, AbortController, AbortSignal,
    TextEncoder, TextDecoder, atob, btoa, structuredClone,
    require: (name) => {
      if (allowedCjs[name]) return require(allowedCjs[name]);
      if (allowedInternal[name]) return allowedInternal[name];
      throw new Error(`Module not allowed: ${name}`);
    },
    // __import__ is used by transformed handler code (import() cannot be overridden in VM)
    __import__: async (specifier) => {
      const preloaded = getEsm();
      const match = allowedEsm.find(m => specifier === m || specifier.startsWith(m + '/'));
      if (!match) throw new Error(`Module not allowed: ${specifier}`);
      if (preloaded[match]) return preloaded[match];
      return import(specifier);
    },
    httpGet: async (url, options = {}) => {
      const https = require('https');
      const http = require('http');
      const { URL } = require('url');
      return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const timeout = options.timeout || 10000;
        const headers = Object.assign({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }, options.headers || {});
        const reqOpts = { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: options.method || 'GET', headers, timeout };
        const req = client.request(reqOpts, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
      });
    }
  };

  sandbox.req = context.req;
  sandbox.file = context.file;
  sandbox.user = context.user;
  sandbox.api = context.api;
  sandbox.helpers = context.helpers;
  sandbox.db = context.db;

  // processFile: temp files in project temp/ dir, stream via downloadUrl, auto-cleanup
  const fs = require('fs');
  const os = require('os');
  const pathMod = require('path');
  const { v4: uuid } = require('uuid');
  const ytdlTempDir = require('path').join(__dirname, '..', 'temp');
  const execFile = require('child_process').execFile;
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  const writeTemp = (buffer, ext = '') => {
    const tmpPath = pathMod.join(ytdlTempDir, `gw_${uuid()}${ext}`);
    fs.writeFileSync(tmpPath, buffer);
    return { path: tmpPath, cleanup: () => { try { fs.unlinkSync(tmpPath); } catch {} } };
  };

  const streamResult = (filePath, size) => {
    const registered = fileTtl.register(filePath);
    const base = (process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    return {
      filename: registered.filename,
      downloadUrl: base + '/gateway/download/' + encodeURIComponent(registered.filename),
      size
    };
  };

  sandbox.processFile = {
    download: async (url, options = {}) => {
      const axios = (await import('axios')).default;
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: options.timeout || 120000 });
      const disposition = response.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || pathMod.basename(new URL(url).pathname) || 'downloaded';
      return { buffer: Buffer.from(response.data), size: response.data.byteLength, mime: response.headers['content-type'] || 'application/octet-stream', filename };
    },
    convertAudio: async (input, options = {}) => {
      const { format = 'mp3', bitrate = '192k' } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) { tmpIn = writeTemp(input, pathMod.extname(options.filename || '.input') || '.bin'); }
        else { tmpIn = { path: input, cleanup: () => {} }; }
        const outPath = pathMod.join(ytdlTempDir, `gw_${uuid()}.${format}`);
        await ffmpeg.toFormat(tmpIn.path, outPath, format, { audioBitrate: bitrate });
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally { tmpIn.cleanup(); }
    },
    resizeImage: async (input, options = {}) => {
      const { width = 800, height, ext = 'jpg' } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) { tmpIn = writeTemp(input, `.${ext}`); }
        else { tmpIn = { path: input, cleanup: () => {} }; }
        const outPath = pathMod.join(ytdlTempDir, `gw_${uuid()}.${ext}`);
        await ffmpeg.resize(tmpIn.path, outPath, width, height);
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally { tmpIn.cleanup(); }
    },
    compressVideo: async (input, options = {}) => {
      const { width = 1280, videoBitrate = '1M', audioBitrate = '128k' } = options;
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) { tmpIn = writeTemp(input, '.mp4'); }
        else { tmpIn = { path: input, cleanup: () => {} }; }
        const outPath = pathMod.join(ytdlTempDir, `gw_${uuid()}.mp4`);
        const args = ['-i', tmpIn.path, '-y', '-c:v', 'libx264', '-c:a', 'copy', '-vf', `scale=${width}:-2`, '-b:v', videoBitrate, '-b:a', audioBitrate, '-preset', 'fast', outPath];
        await execFileAsync('ffmpeg', args, { timeout: 300_000 });
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally { tmpIn.cleanup(); }
    },
    trimVideo: async (input, options = {}) => {
      const { start = 0, end } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) { tmpIn = writeTemp(input, '.mp4'); }
        else { tmpIn = { path: input, cleanup: () => {} }; }
        const outPath = pathMod.join(ytdlTempDir, `gw_${uuid()}.mp4`);
        await ffmpeg.trim(tmpIn.path, outPath, parseFloat(start), parseFloat(end));
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally { tmpIn.cleanup(); }
    },
    thumbnail: async (input, options = {}) => {
      const { time = 1 } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) { tmpIn = writeTemp(input, '.mp4'); }
        else { tmpIn = { path: input, cleanup: () => {} }; }
        const outPath = pathMod.join(ytdlTempDir, `gw_${uuid()}.jpg`);
        await ffmpeg.thumbnail(tmpIn.path, outPath, parseFloat(time));
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally { tmpIn.cleanup(); }
    },
    probe: async (input) => {
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) { tmpIn = writeTemp(input); }
        else { tmpIn = { path: input, cleanup: () => {} }; }
        return await ffmpeg.probe(tmpIn.path);
      } finally { tmpIn.cleanup(); }
    },
    toTemp: (buffer, ext = '') => writeTemp(buffer, ext),
    stream: (buffer, ext = '') => {
      const tmp = writeTemp(buffer, ext);
      return streamResult(tmp.path, buffer.length || buffer.byteLength || 0);
    },
    cleanup: (filePath) => { try { fs.unlinkSync(filePath); } catch {} }
  };

  // Puppeteer helpers (browser automation) — same as gatewayController
  sandbox.browser = {
    screenshot: async (url, options = {}) => {
      const puppeteer = require('../script/puppeteer');
      return await puppeteer.screenshot(url, null, {
        width: options.width || 1280,
        height: options.height || 720,
        fullPage: options.fullPage || false,
        format: options.format || 'png',
        quality: options.quality,
        selector: options.selector,
        delay: options.delay || 0,
        userAgent: options.userAgent,
        waitUntil: options.waitUntil,
        navigateTimeout: options.navigateTimeout
      });
    },
    toPdf: async (url, options = {}) => {
      const puppeteer = require('../script/puppeteer');
      return await puppeteer.toPdf(url, null, {
        format: options.format || 'A4',
        landscape: options.landscape || false,
        printBackground: options.printBackground !== false,
        scale: options.scale || 1,
        margin: options.margin,
        headerTemplate: options.headerTemplate,
        footerTemplate: options.footerTemplate,
        delay: options.delay || 0,
        waitUntil: options.waitUntil,
        navigateTimeout: options.navigateTimeout
      });
    },
    getContent: async (url, options = {}) => {
      const puppeteer = require('../script/puppeteer');
      return await puppeteer.getContent(url, {
        selector: options.selector || 'body',
        format: options.format || 'text',
        userAgent: options.userAgent,
        delay: options.delay || 0,
        waitSelectors: options.waitSelectors,
        waitUntil: options.waitUntil,
        navigateTimeout: options.navigateTimeout
      });
    },
    renderHtml: async (html, options = {}) => {
      const puppeteer = require('../script/puppeteer');
      return await puppeteer.renderHtml(html, null, {
        width: options.width || 1280,
        height: options.height || 720,
        format: options.format || 'png',
        quality: options.quality,
        fullPage: options.fullPage || false,
        styles: options.styles
      });
    },
    evaluate: async (url, script, options = {}) => {
      const puppeteer = require('../script/puppeteer');
      return await puppeteer.evaluate(url, script, {
        args: options.args,
        delay: options.delay || 0,
        waitUntil: options.waitUntil,
        navigateTimeout: options.navigateTimeout
      });
    }
  };

  const blocked = ['process.', 'child_process', 'fs.', 'eval(', 'Function(', '__dirname', '__filename'];
  for (const pattern of blocked) {
    if (code.includes(pattern)) throw new Error(`Blocked: ${pattern}`);
  }


  const requireMatches = code.match(/require\s*\(\s*['"][^'"]+['"]\s*\)/g) || [];
  for (const m of requireMatches) {
    const mod = m.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
    if (mod && allowedCjs[mod] === undefined && allowedInternal[mod] === undefined) {
      throw new Error(`Module not allowed: ${mod}`);
    }
  }

  // Transform handler code: replace import() with __import__() (native import cannot be overridden in VM)
  const transformedCode = code.replace(/\bimport\s*\(/g, '__import__(');

  const vmContext = vm.createContext(sandbox);
  const wrappedCode = `(async () => { ${transformedCode} })()`;
  const script = new vm.Script(wrappedCode, { timeout: 10000 });
  const result = await script.runInContext(vmContext, { timeout: 10000 });

  if (result && typeof result === 'object' && typeof result.status === 'number') return result;
  return { status: 200, data: result, error: null };
}

module.exports = playgroundController;
