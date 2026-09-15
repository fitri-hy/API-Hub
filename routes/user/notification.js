const express = require('express');
const router = express.Router();
const Notification = require('../../models/Notification');
const helpers = require('../../utils/helpers');

// Guard: block access if notifications disabled
router.use(async (req, res, next) => {
  if (!(await Notification.isEnabled())) {
    req.flash('error', 'Notifications are currently disabled');
    return res.redirect('/user/dashboard');
  }
  next();
});

// ============================================================
// GET /user/notification — User notification list
// ============================================================
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const page = parseInt(req.query.page) || 1;
    const unreadOnly = req.query.unread === '1';
    const { notifications, total } = await Notification.listByUser(userId, { page, limit: 20, unreadOnly, target: 'user' });
    const unreadCount = await Notification.getUnreadCount(userId, 'user');

    notifications.forEach(n => {
      try { n.parsed_metadata = n.metadata ? JSON.parse(n.metadata) : null; } catch { n.parsed_metadata = null; }
    });

    const currentFilter = unreadOnly ? 'unread' : null;

    res.render('notifications', {
      title: 'Notifications',
      layout: 'layouts/user',
      userData: req.user,
      notifications,
      unreadCount,
      pagination: helpers.paginate(total, page, 20),
      basePath: '/user',
      currentFilter,
      helpers
    });
  } catch (err) {
    console.error('User notifications page error:', err);
    req.flash('error', 'Failed to load notifications');
    return res.redirect('/user/dashboard');
  }
});

module.exports = router;
