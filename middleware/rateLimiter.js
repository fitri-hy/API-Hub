const db = require('../config/database');
const AdminSettings = require('../models/AdminSettings');

/**
 * Resolve the effective rate limit per minute using priority chain:
 * 1. Package rate_limit_per_minute (if set)
 * 2. User custom_rate_limit (if set)
 * 3. API rate_limit_per_minute (if set)
 * 4. Global default from admin_settings (global_rate_limit)
 */
async function resolveRateLimit({ packageRateLimit, userCustomRateLimit, apiRateLimit }) {
  // Priority 1: Package rate limit
  if (packageRateLimit != null && packageRateLimit > 0) {
    return { limit: packageRateLimit, source: 'package' };
  }

  // Priority 2: User custom rate limit
  if (userCustomRateLimit != null && userCustomRateLimit > 0) {
    return { limit: userCustomRateLimit, source: 'user' };
  }

  // Priority 3: API rate limit
  if (apiRateLimit != null && apiRateLimit > 0) {
    return { limit: apiRateLimit, source: 'api' };
  }

  // Priority 4: Global default from admin settings
  const globalLimit = await AdminSettings.get('global_rate_limit');
  if (globalLimit != null && globalLimit > 0) {
    return { limit: globalLimit, source: 'global' };
  }

  // Ultimate fallback (should never happen if DB is seeded)
  return { limit: 100, source: 'hardcoded_default' };
}

class RateLimiter {
  // Resolve effective rate limit from package → user → api → global
  static async resolveEffectiveLimit({ packageRateLimit, userCustomRateLimit, apiRateLimit }) {
    return resolveRateLimit({ packageRateLimit, userCustomRateLimit, apiRateLimit });
  }

  // Check rate limit per API key
  static async check(apiKeyId, apiId, limitPerMinute) {
    const windowStart = new Date();
    windowStart.setSeconds(0, 0);

    try {
      const [existing] = await db.query(
        `SELECT * FROM rate_limits WHERE api_key_id = ? AND api_id = ? AND window_start = ?`,
        [apiKeyId, apiId, windowStart]
      );

      if (existing.length > 0) {
        const record = existing[0];
        if (record.request_count >= record.max_requests) {
          return { allowed: false, current: record.request_count, limit: record.max_requests, resetIn: 60 - new Date().getSeconds() };
        }

        await db.query('UPDATE rate_limits SET request_count = request_count + 1 WHERE id = ?', [record.id]);
        return { allowed: true, current: record.request_count + 1, limit: record.max_requests, resetIn: 60 - new Date().getSeconds() };
      }

      await db.query(
        `INSERT INTO rate_limits (api_key_id, api_id, window_start, request_count, max_requests)
         VALUES (?, ?, ?, 1, ?)`,
        [apiKeyId, apiId, windowStart, limitPerMinute]
      );

      return { allowed: true, current: 1, limit: limitPerMinute, resetIn: 60 - new Date().getSeconds() };
    } catch (err) {
      console.error('Rate limit check failed:', err);
      return { allowed: true, current: 0, limit: limitPerMinute, resetIn: 60 };
    }
  }

  // Express middleware (in-memory for dashboard)
  static middleware(windowMs = 60000, max = null) {
    const hits = new Map();
    
    // If max is null, try to get from admin_settings
    const getMax = async () => {
      if (max !== null) return max;
      try {
        const setting = await AdminSettings.get('global_rate_limit');
        return parseInt(setting) || 500;
      } catch {
        return 500;
      }
    };

    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of hits) {
        if (now - data.windowStart > windowMs * 2) hits.delete(key);
      }
    }, 5 * 60 * 1000);

    return async (req, res, next) => {
      const currentMax = await getMax();
      const key = req.session?.userId || req.ip;
      const now = Date.now();
      let record = hits.get(key);
      if (!record || now - record.windowStart > windowMs) {
        record = { windowStart: now, count: 0 };
        hits.set(key, record);
      }
      record.count++;

      res.set('X-RateLimit-Limit', String(currentMax));
      res.set('X-RateLimit-Remaining', String(Math.max(0, currentMax - record.count)));
      res.set('X-RateLimit-Reset', String(Math.ceil((record.windowStart + windowMs) / 1000)));

      if (record.count > currentMax) {
        return res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: `Rate limit: ${currentMax} per ${Math.ceil(windowMs / 1000)}s`, retryAfter: Math.ceil((record.windowStart + windowMs - now) / 1000) }
        });
      }
      next();
    };
  }
}

module.exports = RateLimiter;
