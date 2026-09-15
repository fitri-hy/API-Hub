const User = require('../models/User');
const ApiKey = require('../models/ApiKey');

// Load user from session
async function loadUser(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/auth/login');
  }
  const user = await User.findById(req.session.userId);
  if (!user || user.deleted_at) {
    req.session.destroy();
    req.flash('error', 'Session expired');
    return res.redirect('/auth/login');
  }
  req.user = user;
  res.locals.user = user;
  next();
}

// Require any authenticated user
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/auth/login');
  }
  next();
}

// Require admin
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/auth/login');
  }
  if (req.session.role !== 'admin') {
    req.flash('error', 'Access denied. Only admins can access this page.');
    return res.redirect('/');
  }
  next();
}

// Require authenticated user (admin & user roles allowed)
function requireUser(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/auth/login');
  }
  if (!['admin', 'user'].includes(req.session.role)) {
    req.flash('error', 'Access denied');
    return res.redirect('/');
  }
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin, requireUser };
