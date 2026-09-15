const express = require('express');
const router = express.Router();
const Notification = require('../../models/Notification');
const User = require('../../models/User');
const db = require('../../config/database');
const helpers = require('../../utils/helpers');

// Guard: block access if notifications disabled
router.use(async (req, res, next) => {
  if (!(await Notification.isEnabled())) {
    req.flash('error', 'Notifications are currently disabled');
    return res.redirect('/admin/dashboard');
  }
  next();
});

// ============================================================
// GET /admin/notification — Admin notification list
// ============================================================
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const page = parseInt(req.query.page) || 1;
    const unreadOnly = req.query.unread === '1';
    const { notifications, total } = await Notification.listByUser(userId, { page, limit: 20, unreadOnly, target: 'admin' });
    const unreadCount = await Notification.getUnreadCount(userId, 'admin');

    notifications.forEach(n => {
      try { n.parsed_metadata = n.metadata ? JSON.parse(n.metadata) : null; } catch { n.parsed_metadata = null; }
    });

    const currentFilter = unreadOnly ? 'unread' : null;

    res.render('notifications', {
      title: 'Notifications',
      layout: 'layouts/admin',
      userData: req.user,
      notifications,
      unreadCount,
      pagination: helpers.paginate(total, page, 20),
      basePath: '/admin',
      currentFilter,
      helpers
    });
  } catch (err) {
    console.error('Admin notifications page error:', err);
    req.flash('error', 'Failed to load notifications');
    return res.redirect('/admin/dashboard');
  }
});

// ============================================================
// POST /admin/notification/push — Admin push notification
// ============================================================
router.post('/push', async (req, res) => {
  try {
    const { recipient, title, message, link, image_url } = req.body;

    if (!title || !title.trim()) {
      req.flash('error', 'Title is required');
      return res.redirect('/admin/push-notification');
    }
    if (!message || !message.trim()) {
      req.flash('error', 'Message is required');
      return res.redirect('/admin/push-notification');
    }

    const result = await Notification.pushNotification({
      adminId: req.session.userId,
      recipient: recipient || 'all',
      title: title.trim(),
      message: message.trim(),
      link: link || null,
      image_url: image_url || null
    });

    // Socket.IO emission is now handled by Notification model (broadcast/sendToUser)

    req.flash('success', `Notification sent to ${recipient === 'all' ? 'all users' : recipient}`);
    return res.redirect('/admin/push-notification');
  } catch (err) {
    console.error('Push notification error:', err);
    req.flash('error', 'Failed to send notification');
    return res.redirect('/admin/push-notification');
  }
});

module.exports = router;
