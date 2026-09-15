const db = require('../config/database');
const crypto = require('crypto');

class Referral {
  /**
   * Generate a unique referral code (8 chars, uppercase alphanumeric)
   */
  static generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding ambiguous chars (0,O,1,I)
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  /**
   * Ensure a unique referral code, retry on collision
   */
  static async createUniqueCode() {
    const conn = await db.getConnection();
    try {
      let code;
      let attempts = 0;
      do {
        code = this.generateCode();
        const [existing] = await conn.query(
          'SELECT id FROM users WHERE referral_code = ?', [code]
        );
        if (existing.length === 0) return code;
        attempts++;
      } while (attempts < 10);
      throw new Error('Failed to generate unique referral code after 10 attempts');
    } finally {
      conn.release();
    }
  }

  /**
   * Process a referral: record referral and award credits to referrer AND referred user
   */
  static async processReferral(referrerId, referredId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Check if already referred
      const [existing] = await conn.query(
        'SELECT id FROM referrals WHERE referred_id = ?', [referredId]
      );
      if (existing.length > 0) {
        await conn.rollback();
        return { success: false, message: 'This user was already referred' };
      }

      // Check if referrer is the same as referred
      if (referrerId === referredId) {
        await conn.rollback();
        return { success: false, message: 'Cannot refer yourself' };
      }

      // Get referral credit amounts from settings
      const [referrerSettings] = await conn.query(
        "SELECT setting_value FROM admin_settings WHERE setting_key = 'referral_credit_amount'"
      );
      const referrerCredit = referrerSettings.length > 0 ? parseInt(referrerSettings[0].setting_value) : 50;

      const [referredSettings] = await conn.query(
        "SELECT setting_value FROM admin_settings WHERE setting_key = 'new_referral_credit_amount'"
      );
      const referredCredit = referredSettings.length > 0 ? parseInt(referredSettings[0].setting_value) : 25;

      // Create referral record
      await conn.query(
        `INSERT INTO referrals (referrer_id, referred_id, credits_awarded, status)
         VALUES (?, ?, ?, 'completed')`,
        [referrerId, referredId, referrerCredit]
      );

      // Award credits to referrer
      if (referrerCredit > 0) {
        // Ensure credits record exists
        const [credits] = await conn.query(
          'SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [referrerId]
        );
        if (credits.length === 0) {
          await conn.query(
            'INSERT INTO credits (user_id, balance, total_earned, total_spent) VALUES (?, 0, 0, 0)',
            [referrerId]
          );
        }

        const [currentCredits] = await conn.query(
          'SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [referrerId]
        );
        const newBalance = currentCredits[0].balance + referrerCredit;

        await conn.query(
          'UPDATE credits SET balance = ?, total_earned = total_earned + ?, updated_at = NOW() WHERE user_id = ?',
          [newBalance, referrerCredit, referrerId]
        );

        // Log credit transaction
        const [referredUser] = await conn.query(
          'SELECT username FROM users WHERE id = ?', [referredId]
        );
        const referredName = referredUser.length > 0 ? referredUser[0].username : 'Unknown';
        await conn.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type, reference_id)
           VALUES (?, 'bonus', ?, ?, ?, 'referral', ?)`,
          [referrerId, referrerCredit, newBalance, `Referral bonus: invited ${referredName}`, referredId]
        );
      }

      // Award credits to referred user (new user)
      if (referredCredit > 0) {
        const [credits] = await conn.query(
          'SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [referredId]
        );
        if (credits.length === 0) {
          await conn.query(
            'INSERT INTO credits (user_id, balance, total_earned, total_spent) VALUES (?, 0, 0, 0)',
            [referredId]
          );
        }

        const [currentCredits] = await conn.query(
          'SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [referredId]
        );
        const newBalance = currentCredits[0].balance + referredCredit;

        await conn.query(
          'UPDATE credits SET balance = ?, total_earned = total_earned + ?, updated_at = NOW() WHERE user_id = ?',
          [newBalance, referredCredit, referredId]
        );

        // Log credit transaction for referred user
        const [referrerUser] = await conn.query(
          'SELECT username FROM users WHERE id = ?', [referrerId]
        );
        const referrerName = referrerUser.length > 0 ? referrerUser[0].username : 'Unknown';
        await conn.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type, reference_id)
           VALUES (?, 'bonus', ?, ?, ?, 'referral', ?)`,
          [referredId, referredCredit, newBalance, `Referral bonus: joined via ${referrerName}`, referrerId]
        );
      }

      await conn.commit();
      return {
        success: true,
        message: `Referral processed. ${referrerCredit} credits to referrer, ${referredCredit} credits to new user.`,
        referrerCredits: referrerCredit,
        referredCredits: referredCredit
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Get referral stats for a user
   */
  static async getStats(userId) {
    const [totalReferred] = await db.query(
      'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?', [userId]
    );
    const [totalCredits] = await db.query(
      'SELECT COALESCE(SUM(credits_awarded), 0) as total FROM referrals WHERE referrer_id = ?', [userId]
    );
    const [recentReferrals] = await db.query(
      `SELECT r.*, u.username, u.email, u.full_name, u.created_at as user_created_at
       FROM referrals r
       JOIN users u ON r.referred_id = u.id
       WHERE r.referrer_id = ?
       ORDER BY r.created_at DESC LIMIT 10`, [userId]
    );

    return {
      totalReferred: totalReferred[0].count,
      totalCreditsEarned: totalCredits[0].total,
      recentReferrals
    };
  }

  /**
   * List all referrals (admin report) with pagination
   */
  static async listAll({ page = 1, limit = 20, search = '' } = {}) {
    let whereClause = '';
    const params = [];

    if (search) {
      whereClause = `WHERE ref.username LIKE ? OR ref.email LIKE ? OR ru.username LIKE ? OR ru.email LIKE ?`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM referrals r
       JOIN users ru ON r.referrer_id = ru.id
       JOIN users ru2 ON r.referred_id = ru2.id
       ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [referrals] = await db.query(
      `SELECT r.*,
              ru.username AS referrer_username, ru.email AS referrer_email, ru.full_name AS referrer_name,
              ru2.username AS referred_username, ru2.email AS referred_email, ru2.full_name AS referred_name
       FROM referrals r
       JOIN users ru ON r.referrer_id = ru.id
       JOIN users ru2 ON r.referred_id = ru2.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { referrals, total };
  }

  /**
   * Get admin referral summary stats
   */
  static async getAdminStats() {
    const [totalReferrals] = await db.query('SELECT COUNT(*) as count FROM referrals');
    const [totalCreditsAwarded] = await db.query(
      'SELECT COALESCE(SUM(credits_awarded), 0) as total FROM referrals'
    );
    const [activeReferrers] = await db.query(
      'SELECT COUNT(DISTINCT referrer_id) as count FROM referrals'
    );
    const [todayReferrals] = await db.query(
      'SELECT COUNT(*) as count FROM referrals WHERE DATE(created_at) = CURDATE()'
    );

    return {
      totalReferrals: totalReferrals[0].count,
      totalCreditsAwarded: totalCreditsAwarded[0].total,
      activeReferrers: activeReferrers[0].count,
      todayReferrals: todayReferrals[0].count
    };
  }
}

module.exports = Referral;
