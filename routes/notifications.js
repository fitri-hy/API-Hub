const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { loadUser } = require('../middleware/auth');

// All notification routes require authentication
// Use a lightweight auth check that returns JSON 401 instead of redirect
router.use((req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
});

// Guard: block access if notifications disabled
router.use(async (req, res, next) => {
  if (!(await Notification.isEnabled())) {
    return res.status(403).json({ success: false, message: 'Notifications are disabled' });
  }
  next();
});

// ============================================================
// GET /notifications/poll — Polling fallback (for non-socket clients)
// ============================================================
router.get('/poll', async (req, res) => {
  try {
    const userId = req.session.userId;
    const role = req.session.role;
    const target = role === 'admin' ? 'admin' : 'user';
    const sinceId = parseInt(req.query.since) || 0;
    const unreadCount = await Notification.getUnreadCount(userId, target);
    // Always return latest notifications on initial load (since=0) or new ones (since>0)
    const notifications = await Notification.getLatest(userId, { sinceId, limit: 15, target });

    res.json({
      success: true,
      data: { unreadCount, notifications, timestamp: Date.now() }
    });
  } catch (err) {
    console.error('Notification poll error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// ============================================================
// GET /notifications/unread-count — Lightweight count
// ============================================================
router.get('/unread-count', async (req, res) => {
  try {
    const role = req.session.role;
    const target = role === 'admin' ? 'admin' : 'user';
    const count = await Notification.getUnreadCount(req.session.userId, target);
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, count: 0 });
  }
});

// ============================================================
// POST /notifications/mark-read/:id
// ============================================================
router.post('/mark-read/:id', async (req, res) => {
  try {
    await Notification.markAsRead(parseInt(req.params.id), req.session.userId);
    const role = req.session.role;
    const target = role === 'admin' ? 'admin' : 'user';
    const count = await Notification.getUnreadCount(req.session.userId, target);
    const io = req.app.get('io');
    if (io) io.to(`user:${req.session.userId}`).emit('notification:unread-count', { count });
    res.json({ success: true, unreadCount: count });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ============================================================
// POST /notifications/mark-all-read
// ============================================================
router.post('/mark-all-read', async (req, res) => {
  try {
    const role = req.session.role;
    const target = role === 'admin' ? 'admin' : 'user';
    await Notification.markAllAsRead(req.session.userId, target);
    const io = req.app.get('io');
    if (io) io.to(`user:${req.session.userId}`).emit('notification:unread-count', { count: 0 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ============================================================
// DELETE /notifications/:id
// ============================================================
router.delete('/:id', async (req, res) => {
  try {
    await Notification.delete(parseInt(req.params.id), req.session.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ============================================================
// DELETE /notifications — Clear all
// ============================================================
router.delete('/', async (req, res) => {
  try {
    const role = req.session.role;
    const target = role === 'admin' ? 'admin' : 'user';
    await Notification.deleteAll(req.session.userId, target);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
