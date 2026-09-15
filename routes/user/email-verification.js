const express = require('express');
const router = express.Router();
const EmailOTP = require('../../models/EmailOTP');
const Email = require('../../utils/email');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const SystemLog = require('../../models/SystemLog');
const helpers = require('../../utils/helpers');

// ============================================================
// GET /user/verify-email — Show verification page
// ============================================================
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await User.findById(userId);

    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/user/login');
    }

    // Already verified
    if (user.is_verified) {
      return res.redirect('/user/profile');
    }

    // Check if OTP was recently sent
    const activeOtp = await EmailOTP.getActiveOtp(userId, 'email_verification');
    const smtpConfigured = await Email.isConfigured();

    res.render('user/verify-email', {
      title: 'Verify Email',
      layout: 'layouts/user',
      userData: user,
      activeOtp,
      smtpConfigured,
      helpers
    });
  } catch (err) {
    console.error('Verify email page error:', err);
    req.flash('error', 'Failed to load verification page');
    return res.redirect('/user/profile');
  }
});

// ============================================================
// POST /user/verify-email/send — Send OTP to email
// ============================================================
router.post('/send', async (req, res) => {
  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
  const fail = (msg) => isAjax ? res.json({ success: false, message: msg }) : (req.flash('error', msg), res.redirect('/user/verify-email'));
  const ok = (msg, extra) => isAjax ? res.json({ success: true, message: msg, ...extra }) : (req.flash('success', msg), res.redirect('/user/verify-email'));

  try {
    const userId = req.session.userId;
    const user = await User.findById(userId);

    if (!user) return fail('User not found');
    if (user.is_verified) return isAjax ? res.json({ success: true, message: 'Already verified', verified: true }) : (req.flash('info', 'Your email is already verified'), res.redirect('/user/profile'));

    // Check SMTP configuration
    const smtpConfigured = await Email.isConfigured();
    if (!smtpConfigured) return fail('Email verification is not configured. Please contact admin.');

    // Check if user already has an active OTP (rate limit: 1 per 60 seconds)
    const existingOtp = await EmailOTP.getActiveOtp(userId, 'email_verification');
    if (existingOtp) {
      const timeDiff = (new Date(existingOtp.expires_at) - new Date()) / 1000;
      if (timeDiff > 540) {
        return fail('A verification code was already sent. Please check your email or wait before requesting a new code.');
      }
    }

    // Generate OTP
    const { otp, expiresAt } = await EmailOTP.generate(userId, 'email_verification');

    // Send email
    const sent = await Email.sendOtpEmail(user.email, user.full_name || user.username, otp);
    if (!sent) return fail('Failed to send verification email. Please try again later.');

    // Log
    try {
      await SystemLog.create({
        userId,
        action: 'email_otp_sent',
        details: { email: user.email, purpose: 'email_verification' },
        ipAddress: helpers.getClientIp(req)
      });
    } catch (e) { /* ignore */ }

    return ok(`Verification code sent to ${user.email}`);
  } catch (err) {
    console.error('Send OTP error:', err);
    return fail('Failed to send verification code');
  }
});

// ============================================================
// POST /user/verify-email/verify — Verify OTP code
// ============================================================
router.post('/verify', async (req, res) => {
  const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
  const fail = (msg) => isAjax ? res.json({ success: false, message: msg }) : (req.flash('error', msg), res.redirect('/user/verify-email'));
  const ok = (msg, extra) => isAjax ? res.json({ success: true, message: msg, ...extra }) : (req.flash('success', msg), res.redirect('/user/profile'));

  try {
    const userId = req.session.userId;
    const { otp } = req.body;

    if (!otp || !otp.trim()) return fail('Please enter the verification code');

    const user = await User.findById(userId);
    if (!user) return fail('User not found');
    if (user.is_verified) return isAjax ? res.json({ success: true, message: 'Already verified', verified: true }) : (req.flash('info', 'Your email is already verified'), res.redirect('/user/profile'));

    // Verify OTP
    const result = await EmailOTP.verify(userId, otp.trim(), 'email_verification');

    if (!result.success) return fail(result.message);

    // Mark user as verified
    await User.update(userId, { is_verified: 1 });

    // Send notification
    try {
      await Notification.sendToUser(userId, {
        type: 'verification_approved',
        title: 'Email Verified',
        message: 'Your email has been successfully verified. Your account now has a verified badge!',
        icon: 'shield-check',
        link: '/user/profile'
      });
    } catch (e) { /* ignore */ }

    // Log
    try {
      await SystemLog.create({
        userId,
        action: 'email_verified',
        details: { email: user.email },
        ipAddress: helpers.getClientIp(req)
      });
    } catch (e) { /* ignore */ }

    return ok('Your email has been verified! Your account now has a verified badge.');
  } catch (err) {
    console.error('Verify OTP error:', err);
    return fail('Failed to verify code');
  }
});

module.exports = router;
