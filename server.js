require('dotenv').config();

// Pre-load ESM modules for VM sandbox (cheerio, node-fetch, etc.)
require('./config/allowedLibrary').loadEsm().then(() => {
  console.log('[ESM] Pre-loaded ESM modules for sandbox');
}).catch(() => {});

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');

const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// ============================================================
// Socket.IO Setup
// ============================================================
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_SOCKET || 'http://localhost:3000',
    credentials: process.env.CORS_CREDENTIALS === 'true'
  },
  methods: ['GET', 'POST'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Share io with Express routes via app.locals
app.set('io', io);

// Socket.IO middleware — load session directly from the store
// This replaces the fragile fakeRes hack with proper session loading.
// Session store, secret, and cookie name are shared from config/session.js.
const sessionMiddleware = app.get('sessionMiddleware');
const sessionStore = app.get('sessionStore');
const sessionSecret = app.get('sessionSecret');
const sessionCookieName = app.get('sessionName');

if (sessionMiddleware) {
  io.use((socket, next) => {
    // Parse the cookie header from the handshake
    const rawCookie = socket.handshake.headers?.cookie || '';
    const unsign = require('cookie-signature').unsign;
    const parseCookie = require('cookie').parse;

    // Extract and unsign the session ID
    let sid = null;
    const cookies = parseCookie(rawCookie);
    const signedCookieVal = cookies[sessionCookieName];

    if (signedCookieVal && sessionSecret) {
      sid = unsign(signedCookieVal, sessionSecret);
    } else if (signedCookieVal) {
      // No secret available — use raw (less safe, but functional)
      sid = signedCookieVal;
    }

    if (!sid) {
      return next(new Error('No session ID in socket handshake'));
    }

    if (!sessionStore) {
      return next(new Error('Session store not configured'));
    }

    // Load session directly from the store (no fakeRes needed)
    sessionStore.get(sid, (err, sess) => {
      if (err) {
        console.error('[Socket.IO] Session store read error:', err.message);
        return next(new Error('Session load failed'));
      }

      if (!sess) {
        return next(new Error('Session not found'));
      }

      // Attach session to the request
      socket.request.session = sess;
      socket.request.sessionID = sid;

      // Provide save method that commits back to the store
      socket.request.session.save = (cb) => {
        sessionStore.set(sid, sess, (saveErr) => {
          if (saveErr) console.error('[Socket.IO] Session save error:', saveErr.message);
          if (cb) cb(saveErr);
        });
      };

      // Provide destroy method
      socket.request.session.destroy = (cb) => {
        sessionStore.destroy(sid, (delErr) => {
          if (delErr) console.error('[Socket.IO] Session destroy error:', delErr.message);
          if (cb) cb(delErr);
        });
      };

      next();
    });
  });
}

// Socket.IO auth middleware — extract session user
io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.userId) {
    socket.userId = session.userId;
    socket.userRole = session.role || 'user';
    next();
  } else {
    next(new Error('Authentication required'));
  }
});

io.on('connection', (socket) => {
  // Join role-specific room
  const room = `role:${socket.userRole}`;
  socket.join(room);

  // Join personal room for targeted notifications
  socket.join(`user:${socket.userId}`);

  // console.log(`  Socket connected: user=${socket.userId} role=${socket.userRole}`);

  // Mark as read via socket
  socket.on('notification:mark-read', async (data) => {
    try {
      const Notification = require('./models/Notification');
      await Notification.markAsRead(data.id, socket.userId);
      const count = await Notification.getUnreadCount(socket.userId, socket.userRole === 'admin' ? 'admin' : 'user');
      socket.emit('notification:unread-count', { count });
    } catch (err) {
      socket.emit('notification:error', { message: 'Failed to mark as read' });
    }
  });

  // Mark all as read via socket
  socket.on('notification:mark-all-read', async () => {
    try {
      const Notification = require('./models/Notification');
      await Notification.markAllAsRead(socket.userId, socket.userRole === 'admin' ? 'admin' : 'user');
      socket.emit('notification:unread-count', { count: 0 });
    } catch (err) {
      socket.emit('notification:error', { message: 'Failed to mark all as read' });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    // console.log(`  Socket disconnected: user=${socket.userId}`);
  });
});

// ============================================================
// Socket.IO helper — emit notification to users
// ============================================================
/**
 * Emit a notification event to specific users or role room
 * @param {Object} params
 * @param {number|number[]} params.userIds - Specific user IDs
 * @param {string} params.target - 'admin' or 'user' (role room)
 * @param {Object} params.notification - The notification data
 * @param {number} params.unreadCount - Updated unread count
 */
function emitNotification({ userIds, target, notification, unreadCount }) {
  if (userIds) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    ids.forEach(id => {
      io.to(`user:${id}`).emit('notification:new', { notification, unreadCount });
    });
  } else if (target) {
    io.to(`role:${target}`).emit('notification:new', { notification, unreadCount });
  }
}

// Export for use in controllers
app.set('emitNotification', emitNotification);

// ============================================================
// Start Server
// ============================================================
server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  ${process.env.APP_NAME || 'My App'} Running`);
  console.log(`  URL: http://${HOST}:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Socket.IO: enabled`);
  console.log('');
  console.log(`  Admin: http://${HOST}:${PORT}/admin/dashboard`);
  console.log(`  User:  http://${HOST}:${PORT}/user/dashboard`);
  console.log(`  API:   http://${HOST}:${PORT}/gateway/`);
  console.log('');
});
