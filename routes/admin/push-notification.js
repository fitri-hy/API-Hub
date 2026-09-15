const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const helpers = require('../../utils/helpers');
const Notification = require('../../models/Notification');

// Guard: block access if notifications disabled
router.use(async (req, res, next) => {
  if (!(await Notification.isEnabled())) {
    req.flash('error', 'Notifications are currently disabled');
    return res.redirect('/admin/dashboard');
  }
  next();
});

// ============================================================
// GET /admin/push-notification — Admin push notification form
// ============================================================
router.get('/', async (req, res) => {
  try {
    // Fetch all active users for the recipient dropdown
    const [users] = await db.query(
      `SELECT id, uuid, username, full_name, email FROM users WHERE role = 'user' AND deleted_at IS NULL ORDER BY username`
    );

    res.render('admin/notification-push', {
      title: 'Send Push Notification',
      layout: 'layouts/admin',
      userData: req.user,
      users,
      helpers
    });
  } catch (err) {
    console.error('Push form error:', err);
    req.flash('error', 'Failed to load push notification form');
    return res.redirect('/admin/dashboard');
  }
});

module.exports = router;
