const Credit = require('../models/Credit');
const RateLimiter = require('./rateLimiter');

/**
 * Credit guard middleware for API gateway
 * Checks if user has enough credits before executing the endpoint
 */
async function creditGuard(req, res, next) {
  const user = req.apiUser;
  const api = req.apiData;

  if (!user || !api) {
    return res.status(500).json({
      success: false,
      error: { code: 'MIDDLEWARE_ERROR', message: 'Missing user or API data' }
    });
  }

  // Admin users get unlimited access
  if (user.role === 'admin') {
    req.creditCost = 0; // Free for admin
    return next();
  }

  const creditCost = api.credit_cost || 1;

  // Check balance
  const balance = await Credit.getBalance(user.id);

  if (balance.balance < creditCost) {
    return res.status(402).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: `Insufficient credits. Required: ${creditCost}, Available: ${balance.balance}`,
        required: creditCost,
        available: balance.balance,
        topUpUrl: '/user/credits'
      }
    });
  }

  // Check rate limit — priority: package → user → api → global
  const apiKeyData = req.apiKeyData || {};
  const rateLimitResult = await RateLimiter.resolveEffectiveLimit({
    packageRateLimit: apiKeyData.package_rate_limit,
    userCustomRateLimit: req.apiUser.custom_rate_limit,
    apiRateLimit: api.rate_limit_per_minute
  });
  const rateCheck = await RateLimiter.check(user.id, api.id, rateLimitResult.limit);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit: ${rateCheck.limit} requests/min (source: ${rateLimitResult.source})`,
        current: rateCheck.current,
        limit: rateCheck.limit,
        source: rateLimitResult.source,
        resetIn: rateCheck.resetIn
      }
    });
  }

  req.creditCost = creditCost;
  req.rateLimitInfo = rateCheck;
  req.rateLimitSource = rateLimitResult.source;
  next();
}

/**
 * Deduct credits after successful request
 */
async function deductCredits(userId, amount, apiId, requestId) {
  return Credit.deduct(
    userId,
    amount,
    `API request to endpoint #${apiId}`,
    'api_request',
    requestId
  );
}

module.exports = { creditGuard, deductCredits };
