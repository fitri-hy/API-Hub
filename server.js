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
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Share io with Express routes via app.locals
app.set('io', io);

// Socket.IO middleware — use session from Express
const sessionMiddleware = app.get('sessionMiddleware');
if (sessionMiddleware) {
  io.use((socket, next) => {
    // express-session needs res.writeHead/res.end stubs to work
    const fakeRes = {
      writeHead: () => fakeRes,
      end: () => fakeRes,
      getHeader: () => null,
      setHeader: () => fakeRes,
      removeHeader: () => fakeRes,
      status: () => fakeRes,
      redirect: () => fakeRes
    };
    sessionMiddleware(socket.request, fakeRes, next);
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
