const vm = require('vm');
const { marked } = require('marked');
const Api = require('../models/Api');
const ApiRoute = require('../models/ApiRoute');
const ApiKey = require('../models/ApiKey');
const fileTtl = require('../script/fileTtl');
const KeyScope = require('../models/KeyScope');
const User = require('../models/User');
const Credit = require('../models/Credit');
const RequestLog = require('../models/RequestLog');
const RateLimiter = require('../middleware/rateLimiter');
const { allowedInternal, allowedCjs, allowedEsm, getEsm } = require('../config/allowedLibrary');

const gatewayController = {
  async handleRequest(req, res) {
    const startTime = Date.now();
    const { slug } = req.params;

    try {
      const api = await Api.findBySlug(slug);
      if (!api) {
        return res.status(404).json({
          success: false,
          error: { code: 'API_NOT_FOUND', message: `API "${slug}" not found` }
        });
      }

      if (api.status !== 'active') {
        return res.status(503).json({
          success: false,
          error: { code: 'API_UNAVAILABLE', message: 'This API is currently unavailable' }
        });
      }

      const apiKeyStr = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKeyStr) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'API key required. Send via X-API-Key header' }
        });
      }

      const apiKeyData = await ApiKey.findByKey(apiKeyStr);
      if (!apiKeyData) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive API key' }
        });
      }

      if (!apiKeyData.user_active) {
        return res.status(403).json({
          success: false,
          error: { code: 'ACCOUNT_DISABLED', message: 'Your account has been disabled' }
        });
      }

      req.apiKeyData = apiKeyData;
      req.apiUser = { id: apiKeyData.uid, username: apiKeyData.username, role: 'user', custom_rate_limit: apiKeyData.custom_rate_limit };

      const hasScopes = await KeyScope.hasAnyScope(apiKeyData.id);
      if (hasScopes) {
        const allowed = await KeyScope.hasScope(apiKeyData.id, api.id, req.method);
        if (!allowed) {
          return res.status(403).json({
            success: false,
            error: { code: 'SCOPE_DENIED', message: `This API key does not have permission to access ${req.method} ${api.slug}` }
          });
        }
      }

      const tail = String(req.params[0] || '').replace(/^\/+/, '');
      const apiPath = tail ? '/' + tail : '/';
      const matchingRoute = await ApiRoute.findByEndpoint(slug, req.method, apiPath);

      if (!matchingRoute) {
        return res.status(404).json({
          success: false,
          error: { code: 'ROUTE_NOT_FOUND', message: `No ${req.method} route for ${apiPath}` }
        });
      }

      req.apiData = api;
      req.apiRoute = matchingRoute;

      const rateLimitResult = await RateLimiter.resolveEffectiveLimit({
        packageRateLimit: apiKeyData.package_rate_limit,
        userCustomRateLimit: apiKeyData.custom_rate_limit,
        apiRateLimit: api.rate_limit_per_minute
      });
      const rateLimit = rateLimitResult.limit;
      const rateCheck = await RateLimiter.check(apiKeyData.id, api.id, rateLimit);

      if (!rateCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit: ${rateCheck.limit} requests/min (source: ${rateLimitResult.source})`,
            retryAfter: rateCheck.resetIn
          }
        });
      }

      const creditCost = api.credit_cost || 1;

      if (apiKeyData.credit_limit > 0 && apiKeyData.credits_used >= apiKeyData.credit_limit) {
        return res.status(402).json({
          success: false,
          error: {
            code: 'API_KEY_CREDIT_LIMIT',
            message: `API key credit limit reached (${apiKeyData.credit_limit}). Used: ${apiKeyData.credits_used}`
          }
        });
      }

      const balance = await Credit.getBalance(apiKeyData.uid);
      if (balance.balance < creditCost) {
        return res.status(402).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: `Need ${creditCost} credit(s), balance: ${balance.balance}`
          }
        });
      }

      let responseBody;
      let responseStatus = 200;
      let errorMessage = null;
      let isSuccess = true;

      try {
        const handlerResult = await executeHandler(matchingRoute.handler_code, {
          req: {
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            headers: req.headers,
            params: req.params
          },
          file: req.file ? {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            encoding: req.file.encoding,
            mimetype: req.file.mimetype,
            size: req.file.size,
            buffer: req.file.buffer
          } : null,
          user: { id: apiKeyData.uid, username: apiKeyData.username },
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
        errorMessage = execError.message;
      }

      const responseTime = Date.now() - startTime;

      let actualCost = 0;
      if (isSuccess && creditCost > 0) {
        const deductResult = await Credit.deduct(apiKeyData.uid, creditCost,
          `API: ${api.name} (${req.method} ${apiPath.replace(/^\/+/, '/')}) via key: ${apiKeyData.name}`, 'api_request', null);
        if (deductResult.success) {
          actualCost = creditCost;
          await ApiKey.deductCredits(apiKeyData.id, creditCost);
        }
      }

      const logId = await RequestLog.create({
        apiId: api.id,
        routeId: matchingRoute.id,
        userId: apiKeyData.uid,
        apiKeyId: apiKeyData.id,
        method: req.method,
        path: req.path,
        queryParams: req.query,
        requestBody: req.body,
        requestHeaders: { 'content-type': req.headers['content-type'], 'user-agent': req.headers['user-agent'] },
        responseStatus,
        responseBody,
        responseTimeMs: responseTime,
        ipAddress: require('../utils/helpers').getClientIp(req),
        userAgent: req.headers['user-agent'],
        creditCost: actualCost,
        isSuccess,
        errorMessage
      });

      await Api.incrementRequest(api.id, isSuccess);

      await require('../config/database').query(
        'UPDATE api_keys SET last_used_at = NOW(), last_used_ip = ? WHERE id = ?',
        [require('../utils/helpers').getClientIp(req), apiKeyData.id]
      );

      res.set('X-Request-Id', String(logId));
      res.set('X-Response-Time', `${responseTime}ms`);
      res.set('X-Credits-Used', String(actualCost));
      res.set('X-RateLimit-Remaining', String(rateCheck.limit - rateCheck.current));
      res.set('X-RateLimit-Source', rateLimitResult.source);

      return res.status(responseStatus).json({
        success: isSuccess,
        data: responseBody,
        meta: {
          requestId: logId,
          responseTime: `${responseTime}ms`,
          creditsUsed: actualCost
        }
      });
    } catch (err) {
      console.error('Gateway error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'GATEWAY_ERROR', message: 'Internal gateway error' }
      });
    }
  },

  async docs(req, res) {
  	const { slug } = req.params;
	  const api = await Api.findBySlug(slug);

	  if (!api) {
		  return res.status(404).render('error', {
	  		title: 'Not Found',
	  		layout: 'layouts/admin',
	  		message: 'API not found',
	  		code: 404
	  	});
	  }

	  const [routes, userData] = await Promise.all([
	  	ApiRoute.findActiveByApiId(api.id),
	  	User.findById(req.session.userId)
	  ]);

	  res.render('gateway/docs', {
		  title: `API Docs: ${api.name}`,
		  layout: 'layouts/admin',
		  api,
		  routes,
		  userData,
		  marked,
		  helpers: require('../utils/helpers')
	  });
  },

  async listPublic(req, res) {
    const { apis } = await Api.list({ limit: 50, status: 'active' });
    res.json({
      apis: apis.filter(a => a.is_public).map(a => ({
        name: a.name, slug: a.slug, description: a.description, version: a.version,
        baseRoute: a.base_route, creditCost: a.credit_cost, docUrl: `/gateway/${a.slug}/docs`
      }))
    });
  }
};

async function executeHandler(code, context) {


  const sandbox = {
    console: { log: (...a) => {}, error: (...a) => {}, warn: (...a) => {}, info: (...a) => {} },

    JSON, Math, Date, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, RegExp, Promise,
    Buffer, ArrayBuffer, SharedArrayBuffer,
    Map, Set, WeakMap, WeakSet,
    Error, TypeError, RangeError, SyntaxError, ReferenceError,
    parseInt, parseFloat,

    setTimeout, setInterval, clearTimeout, clearInterval,

    fetch,
    URL, URLSearchParams,
    AbortController, AbortSignal,
    TextEncoder, TextDecoder,
    atob, btoa,
    structuredClone,

    require: (name) => {
      if (allowedCjs[name]) return require(allowedCjs[name]);
      if (allowedInternal[name]) return allowedInternal[name];
      throw new Error(`Module not allowed: ${name}. Use import() for ESM modules.`);
    },

    // __import__ is used by transformed handler code (import() cannot be overridden in VM)
    __import__: async (specifier) => {
      const preloaded = getEsm();
      const match = allowedEsm.find(m => specifier === m || specifier.startsWith(m + '/'));
      if (!match) throw new Error(`Module not allowed: ${specifier}. Allowed: ${allowedEsm.join(', ')}`);
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

  // processFile: buffer-based file processing (no disk storage)
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { v4: uuid } = require('uuid');
  const ytdlTempDir = require('path').join(__dirname, '..', 'temp');
  const execFile = require('child_process').execFile;
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  // Helper: write buffer to temp file in project temp/ dir, return path + cleanup fn
  const writeTemp = (buffer, ext = '') => {
    const tmpPath = path.join(ytdlTempDir, `gw_${uuid()}${ext}`);
    fs.writeFileSync(tmpPath, buffer);
    return { path: tmpPath, cleanup: () => { try { fs.unlinkSync(tmpPath); } catch {} } };
  };

  // Helper: register temp file for streaming + auto-cleanup, return { filename, downloadUrl, size }
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
    // Download from URL → returns { buffer, size, mime, filename }
    download: async (url, options = {}) => {
      const axios = (await import('axios')).default;
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: options.timeout || 120000
      });
      const disposition = response.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || path.basename(new URL(url).pathname) || 'downloaded';
      return {
        buffer: Buffer.from(response.data),
        size: response.data.byteLength,
        mime: response.headers['content-type'] || 'application/octet-stream',
        filename
      };
    },

    // Convert audio: input = buffer or path → stream result with downloadUrl
    convertAudio: async (input, options = {}) => {
      const { format = 'mp3', bitrate = '192k' } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) {
          tmpIn = writeTemp(input, path.extname(options.filename || '.input') || '.bin');
        } else {
          tmpIn = { path: input, cleanup: () => {} };
        }
        const outPath = path.join(ytdlTempDir, `gw_${uuid()}.${format}`);
        await ffmpeg.toFormat(tmpIn.path, outPath, format, { audioBitrate: bitrate });
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally {
        tmpIn.cleanup();
      }
    },

    // Resize image: input = buffer or path → stream result with downloadUrl
    resizeImage: async (input, options = {}) => {
      const { width = 800, height, ext = 'jpg' } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) {
          tmpIn = writeTemp(input, `.${ext}`);
        } else {
          tmpIn = { path: input, cleanup: () => {} };
        }
        const outPath = path.join(ytdlTempDir, `gw_${uuid()}.${ext}`);
        await ffmpeg.resize(tmpIn.path, outPath, width, height);
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally {
        tmpIn.cleanup();
      }
    },

    // Compress video: input = buffer or path → stream result with downloadUrl
    compressVideo: async (input, options = {}) => {
      const { width = 1280, videoBitrate = '1M', audioBitrate = '128k' } = options;
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) {
          tmpIn = writeTemp(input, '.mp4');
        } else {
          tmpIn = { path: input, cleanup: () => {} };
        }
        const outPath = path.join(ytdlTempDir, `gw_${uuid()}.mp4`);
        const args = [
          '-i', tmpIn.path, '-y',
          '-c:v', 'libx264', '-c:a', 'copy',
          '-vf', `scale=${width}:-2`,
          '-b:v', videoBitrate, '-b:a', audioBitrate,
          '-preset', 'fast', outPath
        ];
        await execFileAsync('ffmpeg', args, { timeout: 300_000 });
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally {
        tmpIn.cleanup();
      }
    },

    // Trim video: input = buffer or path → stream result with downloadUrl
    trimVideo: async (input, options = {}) => {
      const { start = 0, end } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) {
          tmpIn = writeTemp(input, '.mp4');
        } else {
          tmpIn = { path: input, cleanup: () => {} };
        }
        const outPath = path.join(ytdlTempDir, `gw_${uuid()}.mp4`);
        await ffmpeg.trim(tmpIn.path, outPath, parseFloat(start), parseFloat(end));
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally {
        tmpIn.cleanup();
      }
    },

    // Thumbnail: input = buffer or path → stream result with downloadUrl
    thumbnail: async (input, options = {}) => {
      const { time = 1 } = options;
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) {
          tmpIn = writeTemp(input, '.mp4');
        } else {
          tmpIn = { path: input, cleanup: () => {} };
        }
        const outPath = path.join(ytdlTempDir, `gw_${uuid()}.jpg`);
        await ffmpeg.thumbnail(tmpIn.path, outPath, parseFloat(time));
        const stat = fs.statSync(outPath);
        return streamResult(outPath, stat.size);
      } finally {
        tmpIn.cleanup();
      }
    },

    // Probe: input = buffer or string path → returns media info
    probe: async (input) => {
      const ffmpeg = require('../script/ffmpeg');
      let tmpIn;
      try {
        if (Buffer.isBuffer(input)) {
          tmpIn = writeTemp(input);
        } else {
          tmpIn = { path: input, cleanup: () => {} };
        }
        return await ffmpeg.probe(tmpIn.path);
      } finally {
        tmpIn.cleanup();
      }
    },

    // Write buffer to temp file (for tools that need file path)
    toTemp: (buffer, ext = '') => writeTemp(buffer, ext),

    // Stream buffer to temp file and return download URL → auto-cleanup
    stream: (buffer, ext = '') => {
      const tmp = writeTemp(buffer, ext);
      return streamResult(tmp.path, buffer.length || buffer.byteLength || 0);
    },

    // Cleanup a temp file
    cleanup: (filePath) => { try { fs.unlinkSync(filePath); } catch {} }
  };

  // Puppeteer helpers (browser automation)
  // Same pattern as ytdl: script handles fileTtl + buildDownloadUrl, gateway just passes through
  sandbox.browser = {
    // Screenshot a URL → { filename, downloadUrl, size, width, height }
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

    // Generate PDF from URL → { filename, downloadUrl, size, pages }
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

    // Extract content from URL → { title, content, url, meta } (no file)
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

    // Render HTML string to screenshot → { filename, downloadUrl, size }
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

    // Execute JS in page context → { result, title } (no file)
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
    if (!mod || (allowedCjs[mod] === undefined && allowedInternal[mod] === undefined)) {
      throw new Error(`Module not allowed: ${mod}. Allowed: ${[...Object.keys(allowedCjs), ...Object.keys(allowedInternal)].join(', ')}`);
    }
  }

  // Transform handler code: replace import() with __import__() (native import cannot be overridden in VM)
  const transformedCode = code.replace(/\bimport\s*\(/g, '__import__(');

  const vmContext = vm.createContext(sandbox);
  const wrappedCode = `(async () => { ${transformedCode} })()`;
  // Use 120s VM timeout — actual task concurrency is controlled by script/ limiters
  const script = new vm.Script(wrappedCode, { timeout: 120_000 });
  const result = await script.runInContext(vmContext, { timeout: 120_000 });

  if (result && typeof result === 'object' && typeof result.status === 'number') {
    return result;
  }
  return { status: 200, data: result, error: null };
}

module.exports = gatewayController;
