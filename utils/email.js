const nodemailer = require('nodemailer');
const db = require('../config/database');

// Cache for SMTP settings
let _smtpCache = null;
let _smtpCacheTime = 0;
const SMTP_CACHE_TTL = 30000;

class Email {
  /** Load SMTP settings from admin_settings, caching them for 30 seconds. */
  static async getSmtpSettings() {
    const now = Date.now();
    if (_smtpCache !== null && (now - _smtpCacheTime) < SMTP_CACHE_TTL) {
      return _smtpCache;
    }

    try {
      const [rows] = await db.query(
        `SELECT setting_key, setting_value FROM admin_settings
         WHERE setting_key IN (?, ?, ?, ?, ?, ?, ?)`,
        [
          'smtp_host', 'smtp_port', 'smtp_encryption', 'smtp_username',
          'smtp_password', 'smtp_from_email', 'smtp_from_name'
        ]
      );
      const settings = {};
      rows.forEach(row => { settings[row.setting_key] = row.setting_value; });
      _smtpCache = {
        host: settings.smtp_host || '',
        port: parseInt(settings.smtp_port, 10) || 587,
        encryption: (settings.smtp_encryption || 'tls').toLowerCase(),
        username: settings.smtp_username || '',
        password: settings.smtp_password || '',
        fromEmail: settings.smtp_from_email || '',
        fromName: settings.smtp_from_name || 'SaaSGateway'
      };
    } catch (error) {
      console.error('[Email] Failed to load SMTP settings:', error.message);
      _smtpCache = null;
    }

    _smtpCacheTime = now;
    return _smtpCache;
  }

  /** Clear the SMTP settings cache. */
  static resetCache() {
    _smtpCache = null;
    _smtpCacheTime = 0;
  }

  /** Return whether the required SMTP settings are configured. */
  static async isConfigured() {
    try {
      const settings = await this.getSmtpSettings();
      return !!(settings && settings.host && settings.fromEmail);
    } catch (error) {
      console.error('[Email] Failed to check SMTP configuration:', error.message);
      return false;
    }
  }

  /** Create a nodemailer transport from the configured SMTP settings. */
  static async createTransport() {
    const settings = await this.getSmtpSettings();
    if (!settings || !settings.host) return null;

    const secure = settings.encryption === 'ssl' || settings.port === 465;
    const transportOptions = {
      host: settings.host,
      port: settings.port,
      secure,
      auth: settings.username ? { user: settings.username, pass: settings.password } : undefined
    };
    if (settings.encryption === 'none') transportOptions.secure = false;
    return nodemailer.createTransport(transportOptions);
  }

  /** Verify SMTP connection and send a test email. Returns { success, message }. */
  static async sendTestEmail(toEmail) {
    try {
      const settings = await this.getSmtpSettings();
      if (!settings || !settings.host) {
        return { success: false, message: 'SMTP host is not configured.' };
      }
      if (!settings.fromEmail) {
        return { success: false, message: 'SMTP from-email is not configured.' };
      }

      const transport = await this.createTransport();
      if (!transport) {
        return { success: false, message: 'Failed to create SMTP transport.' };
      }

      // Verify SMTP connection first
      try {
        await transport.verify();
      } catch (verifyErr) {
        return { success: false, message: `SMTP connection failed: ${verifyErr.message}` };
      }

      const from = settings.fromName ? `"${settings.fromName.replace(/"/g, '')}" <${settings.fromEmail}>` : settings.fromEmail;
      const recipient = toEmail || settings.fromEmail;

      await transport.sendMail({
        from,
        to: recipient,
        subject: 'SaaSGateway — SMTP Test Email',
        text: 'This is a test email from SaaSGateway. If you received this, your SMTP settings are working correctly.',
        html: `<!doctype html>
<html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#374151">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="background:#2563eb;padding:24px;text-align:center;border-radius:10px 10px 0 0">
      <div style="font-size:24px;font-weight:700;color:#fff">SaaSGateway</div>
    </div>
    <div style="background:#fff;padding:36px 32px;border-radius:0 0 10px 10px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
      <h1 style="margin:0 0 16px;color:#111827;font-size:22px">SMTP Test Successful</h1>
      <p style="font-size:16px;line-height:1.6">This is a test email from <strong>SaaSGateway</strong>.</p>
      <p style="font-size:16px;line-height:1.6">If you received this, your SMTP configuration is working correctly.</p>
      <div style="margin:28px 0;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;text-align:center">
        <div style="font-size:15px;font-weight:600;color:#16a34a">SMTP Connection Verified</div>
      </div>
      <p style="font-size:14px;color:#6b7280;line-height:1.5">Host: ${settings.host}:${settings.port} | Encryption: ${settings.encryption.toUpperCase()}</p>
      <p style="margin:28px 0 0;font-size:14px;color:#6b7280">Thanks,<br>The SaaSGateway Team</p>
    </div>
  </div>
</body></html>`
      });

      return { success: true, message: `Test email sent successfully to ${recipient}.` };
    } catch (error) {
      console.error('[Email] Test email failed:', error.message);
      return { success: false, message: `SMTP error: ${error.message}` };
    }
  }

  /** Send an email verification OTP. Errors are logged and returned, not thrown. */
  static async sendOtpEmail(userEmail, userName, otpCode) {
    try {
      const settings = await this.getSmtpSettings();
      if (!settings || !settings.host || !settings.fromEmail) {
        console.warn('[Email] SMTP is not configured; OTP email was not sent.');
        return false;
      }

      const transport = await this.createTransport();
      if (!transport) return false;
      const safeName = String(userName || 'there')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const safeCode = String(otpCode || '').replace(/[^0-9A-Za-z]/g, '');
      const from = settings.fromName ? `"${settings.fromName.replace(/"/g, '')}" <${settings.fromEmail}>` : settings.fromEmail;

      await transport.sendMail({
        from,
        to: userEmail,
        subject: 'Your Verification Code',
        text: `Hi ${userName || 'there'},\n\nYour verification code is: ${safeCode}\n\nThis code expires in 10 minutes. If you did not request this code, you can safely ignore this email.`,
        html: `<!doctype html>
<html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#374151">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="background:#2563eb;padding:24px;text-align:center;border-radius:10px 10px 0 0">
      <div style="font-size:24px;font-weight:700;color:#fff">SaaSGateway</div>
    </div>
    <div style="background:#fff;padding:36px 32px;border-radius:0 0 10px 10px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
      <h1 style="margin:0 0 16px;color:#111827;font-size:24px">Verify your email</h1>
      <p style="font-size:16px;line-height:1.6">Hi ${safeName},</p>
      <p style="font-size:16px;line-height:1.6">Use the verification code below to continue:</p>
      <div style="margin:28px 0;padding:22px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;text-align:center">
        <div style="font-size:36px;letter-spacing:10px;font-weight:700;color:#2563eb">${safeCode}</div>
      </div>
      <p style="font-size:14px;color:#6b7280;line-height:1.5">This code expires in <strong>10 minutes</strong>. If you did not request this code, you can safely ignore this email.</p>
      <p style="margin:28px 0 0;font-size:14px;color:#6b7280">Thanks,<br>The SaaSGateway Team</p>
    </div>
  </div>
</body></html>`
      });
      return true;
    } catch (error) {
      console.error('[Email] Failed to send OTP email:', error.message);
      return false;
    }
  }
}

module.exports = Email;
