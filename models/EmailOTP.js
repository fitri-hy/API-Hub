const crypto = require('crypto');
const db = require('../config/database');

class EmailOTP {
  /**
   * Generate and store a new OTP for a user.
   *
   * Any currently active OTP for the same user and purpose is invalidated
   * before the new code is stored.
   *
   * @param {number} userId
   * @param {string} purpose
   * @returns {{ otp: string, expiresAt: Date }}
   */
  static async generate(userId, purpose = 'email_verification') {
    const otp = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE email_otps
         SET used = 1
         WHERE user_id = ? AND purpose = ? AND used = 0 AND expires_at > NOW()`,
        [userId, purpose]
      );

      await connection.query(
        `INSERT INTO email_otps
         (user_id, otp_code, purpose, expires_at, attempts, max_attempts, used)
         VALUES (?, ?, ?, ?, 0, 5, 0)`,
        [userId, otp, purpose, expiresAt]
      );

      await connection.commit();
      return { otp, expiresAt };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Verify an OTP code.
   *
   * @param {number} userId
   * @param {string} otp
   * @param {string} purpose
   * @returns {{ success: boolean, message: string }}
   */
  static async verify(userId, otp, purpose = 'email_verification') {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT * FROM email_otps
         WHERE user_id = ? AND purpose = ? AND used = 0 AND expires_at > NOW()
         ORDER BY created_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [userId, purpose]
      );

      if (rows.length === 0) {
        await connection.rollback();
        return { success: false, message: 'Invalid or expired OTP' };
      }

      const record = rows[0];
      const maxAttempts = Number(record.max_attempts) || 5;
      const attempts = Number(record.attempts) || 0;

      if (attempts >= maxAttempts) {
        await connection.rollback();
        return { success: false, message: 'Too many attempts' };
      }

      await connection.query(
        'UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?',
        [record.id]
      );

      if (String(record.otp_code) !== String(otp)) {
        await connection.commit();
        return { success: false, message: 'Invalid OTP' };
      }

      await connection.query(
        'UPDATE email_otps SET used = 1 WHERE id = ?',
        [record.id]
      );

      await connection.commit();
      return { success: true, message: 'OTP verified successfully' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get the latest active OTP for a user and purpose.
   *
   * @param {number} userId
   * @param {string} purpose
   * @returns {object|null}
   */
  static async getActiveOtp(userId, purpose = 'email_verification') {
    const [rows] = await db.query(
      `SELECT * FROM email_otps
       WHERE user_id = ? AND purpose = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId, purpose]
    );
    return rows[0] || null;
  }

  /**
   * Mark an OTP as used.
   */
  static async markUsed(otpId) {
    await db.query('UPDATE email_otps SET used = 1 WHERE id = ?', [otpId]);
  }

  /**
   * Delete OTP records older than one hour.
   */
  static async cleanupExpired() {
    const [result] = await db.query(
      'DELETE FROM email_otps WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)'
    );
    return result.affectedRows;
  }
}

module.exports = EmailOTP;
