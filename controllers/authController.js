const passport = require('../config/passport');

const User = require('../models/User');
const Credit = require('../models/Credit');
const AdminSettings = require('../models/AdminSettings');
const SystemLog = require('../models/SystemLog');
const Referral = require('../models/Referral');
const Notification = require('../models/Notification');
const Webhook = require('../models/Webhook');

// Helper: emit notification via Socket.IO
async function emitToUser(req, userId, notificationData) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const unreadCount = await Notification.getUnreadCount(userId, 'user');
    io.to('user:' + userId).emit('notification:new', { notification: Object.assign({}, notificationData, { user_id: userId }), unreadCount: unreadCount });
  } catch (e) { console.error('Socket emit error:', e); }
}
async function emitToAdmins(req, notificationData) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    io.to('role:admin').emit('notification:new', { notification: notificationData });
  } catch (e) { console.error('Socket emit error:', e); }
}
const helpers = require('../utils/helpers');

const authController = {
  // Show login page
  async getLogin(req, res) {
    if (req.session && req.session.userId) {
      return req.session.role === 'admin'
        ? res.redirect('/admin/dashboard')
        : res.redirect('/user/dashboard');
    }
    // Check captcha setting
    const captchaEnabled = await AdminSettings.get('auth_captcha_enabled');
    let captchaA, captchaB;
    if (captchaEnabled) {
      captchaA = Math.floor(Math.random() * 9) + 1;
      captchaB = Math.floor(Math.random() * (10 - captchaA)) + 1;
      req.session.captchaAnswer = captchaA + captchaB;
    }
    res.render('auth/login', {
      title: 'Login',
      layout: 'layouts/auth',
      captchaEnabled,
      captchaA,
      captchaB
    });
  },

  // Handle login
  async postLogin(req, res) {
    try {
      const { email, password, captchaAnswer } = req.body;

      if (!email || !password) {
        req.flash('error', 'Email and password must be entered.');
        return res.redirect('/auth/login');
      }

      // Validate captcha if enabled
      const captchaEnabled = await AdminSettings.get('auth_captcha_enabled');
      if (captchaEnabled) {
        if (captchaAnswer === undefined || captchaAnswer === '' || parseInt(captchaAnswer) !== req.session.captchaAnswer) {
          req.flash('error', 'Captcha answer is incorrect.');
          return res.redirect('/auth/login');
        }
        delete req.session.captchaAnswer;
      }

      const user = await User.findByEmail(email);
      if (!user) {
        req.flash('error', 'Incorrect email or password');
        return res.redirect('/auth/login');
      }

      // Check if account is active BEFORE password check
      if (!user.is_active) {
        req.flash('error', 'Your account has been deactivated. Please contact the admin to reactivate your account.');
        return res.redirect('/auth/login');
      }

      const isValid = await User.verifyPassword(user, password);
      if (!isValid) {
        req.flash('error', 'Incorrect email or password');
        return res.redirect('/auth/login');
      }

      req.session.userId = user.id;
      req.session.uuid = user.uuid;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.email = user.email;

      await User.updateLastLogin(user.id, helpers.getClientIp(req));

      await SystemLog.create({
        userId: user.id,
        action: 'auth_login',
        details: { email: user.email, role: user.role },
        ipAddress: helpers.getClientIp(req),
        userAgent: req.headers['user-agent']
      });

      // Notify user about new login (skip admin logins and same-IP logins)
      if (user.role === 'user') {
        try {
          await Notification.newLogin(user.id, {
            ip: helpers.getClientIp(req),
            userAgent: req.headers['user-agent'],
            location: null
          });
          await emitToUser(req, user.id, { type: 'new_login', title: 'New Login Detected', message: 'A new login to your account was detected from IP ' + helpers.getClientIp(req) + '.', link: '/user/settings', icon: 'login', is_read: 0, created_at: new Date().toISOString() });
        } catch (e) { console.error('Notification error:', e); }
      }

      req.flash('success', `Welcome, ${user.full_name || user.username}!`);
      return user.role === 'admin'
        ? res.redirect('/admin/dashboard')
        : res.redirect('/user/dashboard');
    } catch (err) {
      console.error('Login error:', err);
      req.flash('error', 'An error occurred during login.');
      return res.redirect('/auth/login');
    }
  },

  // Show register page
  async getRegister(req, res) {
    if (req.session && req.session.userId) {
      return req.session.role === 'admin'
        ? res.redirect('/admin/dashboard')
        : res.redirect('/user/dashboard');
    }

    const registrationEnabled = await AdminSettings.get('registration_enabled');
    if (!registrationEnabled) {
      req.flash('error', 'Registration is currently disabled.');
      return res.redirect('/auth/login');
    }

    const referralEnabled = await AdminSettings.get('referral_enabled');
    const referralCode = req.query.ref || '';

    // Check captcha setting
    const captchaEnabled = await AdminSettings.get('auth_captcha_enabled');
    let captchaA, captchaB;
    if (captchaEnabled) {
      captchaA = Math.floor(Math.random() * 9) + 1;
      captchaB = Math.floor(Math.random() * (10 - captchaA)) + 1;
      req.session.captchaAnswer = captchaA + captchaB;
    }

    res.render('auth/register', {
      title: 'Register',
      layout: 'layouts/auth',
      referralEnabled,
      referralCode,
      captchaEnabled,
      captchaA,
      captchaB
    });
  },

  // Handle register
  async postRegister(req, res) {
    try {
      const registrationEnabled = await AdminSettings.get('registration_enabled');
      if (!registrationEnabled) {
        req.flash('error', 'Registration is currently disabled.');
        return res.redirect('/auth/login');
      }

      const { username, email, password, confirmPassword, fullName, referral_code, captchaAnswer } = req.body;

      if (!username || !email || !password || !confirmPassword) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/auth/register');
      }

      // Validate captcha if enabled
      const captchaEnabled = await AdminSettings.get('auth_captcha_enabled');
      if (captchaEnabled) {
        if (captchaAnswer === undefined || captchaAnswer === '' || parseInt(captchaAnswer) !== req.session.captchaAnswer) {
          req.flash('error', 'Captcha answer is incorrect.');
          return res.redirect('/auth/register');
        }
        delete req.session.captchaAnswer;
      }

      if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters long.');
        return res.redirect('/auth/register');
      }

      if (password !== confirmPassword) {
        req.flash('error', 'Password confirmation does not match.');
        return res.redirect('/auth/register');
      }

      const existingEmail = await User.findByEmail(email);
      if (existingEmail) {
        req.flash('error', 'The email is already registered.');
        return res.redirect('/auth/register');
      }

      const existingUsername = await User.findByUsername(username);
      if (existingUsername) {
        req.flash('error', 'Username is already in use.');
        return res.redirect('/auth/register');
      }

      const user = await User.create({
        username,
        email,
        password,
        fullName: fullName || username,
        role: 'user',
        package_id: null 
      });

      const bonusEnabled = await AdminSettings.get('new_user_bonus_enabled');
      if (bonusEnabled) {
        const bonusCredits = parseInt(await AdminSettings.get('default_credits')) || 0;
        if (bonusCredits > 0) {
          await Credit.add(user.id, bonusCredits, 'Bonus credit for new user', 'bonus', null);
        }
      }

      // Process referral if code provided
      const referralEnabled = await AdminSettings.get('referral_enabled');
      if (referralEnabled && referral_code) {
        const referrer = await User.findByReferralCode(referral_code.trim().toUpperCase());
        if (referrer && referrer.id !== user.id) {
          const referralResult = await Referral.processReferral(referrer.id, user.id);
          if (referralResult.success) {
            console.log(`Referral processed: ${referrer.username} referred ${username}. Credits awarded: ${referralResult.creditsAwarded}`);
          }
        }
      }

      await SystemLog.create({
        userId: user.id,
        action: 'auth_register',
        details: { email, username },
        ipAddress: helpers.getClientIp(req),
        userAgent: req.headers['user-agent']
      });

      // Notify admins about new registration
      try {
        await Notification.newUserRegistered({
          id: user.id,
          uuid: user.uuid,
          username: user.username,
          email: user.email
        });
        await emitToAdmins(req, { type: 'new_user', title: 'New User Registration', message: user.username + ' (' + user.email + ') has registered.', link: '/admin/users/' + user.uuid, icon: 'user-plus', is_read: 0, created_at: new Date().toISOString() });
      } catch (e) { console.error('Notification error:', e); }
      // Webhook dispatch
      try {
        await Webhook.dispatch('user.registered', { user_id: user.id, username: user.username, email: user.email });
      } catch (e) { console.error('Webhook dispatch error:', e); }

      req.flash('success', 'Registration successful! Please log in.');
      return res.redirect('/auth/login');
    } catch (err) {
      console.error('Register error:', err);
      req.flash('error', 'An error occurred during registration.');
      return res.redirect('/auth/register');
    }
  },

  // Logout
  async logout(req, res) {
    if (req.session && req.session.userId) {
      await SystemLog.create({
        userId: req.session.userId,
        action: 'auth_logout',
        ipAddress: helpers.getClientIp(req),
        userAgent: req.headers['user-agent']
      });
    }
    req.session.destroy();
    res.redirect('/auth/login');
  },
  
  // ============ GOOGLE OAUTH ============

  googleLogin: passport.authenticate('google', { scope: ['profile', 'email'] }),

  googleCallback(req, res, next) {
    passport.authenticate('google', async (err, user, info) => {
      try {
        if (err || !user) {
          req.flash('error', 'Google authentication failed.');
          return res.redirect('/auth/login');
        }

        if (!user.is_active) {
          req.flash('error', 'Your account has been deactivated. Please contact the admin to reactivate your account.');
          return res.redirect('/auth/login');
        }

        // Set session user
        req.session.userId = user.id;
        req.session.uuid = user.uuid;
        req.session.role = user.role;
        req.session.username = user.username;
        req.session.email = user.email;

        await User.updateLastLogin(user.id, helpers.getClientIp(req));

        await SystemLog.create({
          userId: user.id,
          action: 'auth_login_google',
          details: { email: user.email, role: user.role },
          ipAddress: helpers.getClientIp(req),
          userAgent: req.headers['user-agent']
        });

        req.flash('success', `Welcome, ${user.full_name || user.username}!`);
        return user.role === 'admin'
          ? res.redirect('/admin/dashboard')
          : res.redirect('/user/dashboard');
      } catch (e) {
        console.error('Google callback error:', e);
        req.flash('error', 'An error occurred during Google login.');
        return res.redirect('/auth/login');
      }
    })(req, res, next);
  },
};

module.exports = authController;