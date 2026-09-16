const session = require('express-session');
const flash = require('connect-flash');
const crypto = require('crypto');

module.exports = (app) => {
  const sessionSecret =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString('hex');

  const sessionMaxAge =
    Number(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000;

  const sessionName = process.env.SESSION_COOKIE_NAME || 'sgw.sid';

  // Use MemoryStore (default) — explicit for clarity
  const sessionStore = new session.MemoryStore();

  const sessionMiddleware = session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.SESSION_SECURE === 'true',
      httpOnly: process.env.SESSION_HTTP_ONLY !== 'false',
      maxAge: sessionMaxAge,
      sameSite: process.env.SESSION_SAME_SITE || 'lax'
    },
    name: sessionName
  });

  app.use(sessionMiddleware);
  app.use(flash());

  // Share session config with Socket.IO (middleware + store + secret + name)
  app.set('sessionMiddleware', sessionMiddleware);
  app.set('sessionStore', sessionStore);
  app.set('sessionSecret', sessionSecret);
  app.set('sessionName', sessionName);
};
