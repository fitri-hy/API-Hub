const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

module.exports = (app) => {
  app.use(helmet({
    contentSecurityPolicy:
      process.env.HELMET_CSP !== 'false',

    crossOriginEmbedderPolicy:
      process.env.HELMET_CROSS_ORIGIN_EMBEDDER_POLICY !== 'false'
  }));

  const corsOrigin = process.env.CORS_ORIGIN || process.env.APP_URL;

  app.use(cors({
    origin: corsOrigin,
    credentials: process.env.CORS_CREDENTIALS !== 'false'
  }));

  const globalLimiter = rateLimit({
    windowMs:
      Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,

    max:
      Number(process.env.RATE_LIMIT_MAX) || 200,

    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT',
        message: 'Too many requests, please try again later'
      }
    },

    standardHeaders: true,
    legacyHeaders: false
  });

  app.use('/gateway/', globalLimiter);
};