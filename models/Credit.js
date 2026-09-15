const db = require('../config/database');
const Notification = require('./Notification');
const AdminSettings = require('./AdminSettings');

// Low credit threshold (legacy constant, now overridden by admin settings)
const LOW_CREDIT_THRESHOLD = 10;

class Credit {
  static async getBalance(userId) {
    const [rows] = await db.query('SELECT * FROM credits WHERE user_id = ?', [userId]);
    return rows[0] || { balance: 0, total_earned: 0, total_spent: 0 };
  }

  static async deduct(userId, amount, description, referenceType = null, referenceId = null) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [credits] = await conn.query('SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [userId]);
      if (!credits.length) { await conn.rollback(); return { success: false, message: 'Credit account not found' }; }

      const currentBalance = credits[0].balance;
      if (currentBalance < amount) {
        await conn.rollback();
        return { success: false, message: `Insufficient credits. Balance: ${currentBalance}, Required: ${amount}` };
      }

      const newBalance = currentBalance - amount;
      await conn.query('UPDATE credits SET balance = ?, total_spent = total_spent + ?, updated_at = NOW() WHERE user_id = ?',
        [newBalance, amount, userId]);

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type, reference_id)
         VALUES (?, 'deduct', ?, ?, ?, ?, ?)`,
        [userId, -amount, newBalance, description, referenceType, referenceId]
      );

      // Check for low credit warnings + bonus grant (before commit so it's in the same tx)
      let bonusGranted = 0;
      let bonusResult = null;
      try {
        const bonusEnabled = await AdminSettings.get('credit_bonus_enabled');
        const bonusThreshold = parseInt(await AdminSettings.get('credit_bonus_threshold')) || 5;

        if (newBalance <= 0) {
          await Notification.creditExhausted(userId);
        } else if (newBalance <= bonusThreshold && currentBalance > bonusThreshold && bonusEnabled) {
          // Credit just dropped below threshold → check verification then grant bonus
          const [userRows] = await conn.query('SELECT is_verified FROM users WHERE id = ?', [userId]);
          if (userRows[0]?.is_verified) {
            bonusResult = await Credit._grantBonus(conn, userId, newBalance);
            bonusGranted = bonusResult.added || 0;
          }
        }
      } catch (e) { console.error('Low credit / bonus error:', e); }

      await conn.commit();

      // Send bonus notifications AFTER commit (outside transaction)
      if (bonusGranted > 0 && bonusResult && bonusResult.tier) {
        try {
          await Notification.creditBonusReceived(userId, { tier: bonusResult.tier, amount: bonusGranted, nextBonusAt: bonusResult.nextBonusAt });
          await Notification.userReceivedBonus(userId, { tier: bonusResult.tier, amount: bonusGranted });
        } catch (e) { console.error('Bonus notification error:', e); }
      }

      return { success: true, balance: newBalance, deducted: amount, bonusGranted };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  static async add(userId, amount, description, referenceType = null, referenceId = null, adminId = null) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      let [credits] = await conn.query('SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [userId]);
      if (!credits.length) {
        await conn.query('INSERT INTO credits (user_id, balance, total_earned, total_spent) VALUES (?, 0, 0, 0)', [userId]);
        [credits] = await conn.query('SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [userId]);
      }

      const newBalance = credits[0].balance + amount;
      await conn.query('UPDATE credits SET balance = ?, total_earned = total_earned + ?, updated_at = NOW() WHERE user_id = ?',
        [newBalance, amount, userId]);

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type, reference_id, admin_id)
         VALUES (?, 'add', ?, ?, ?, ?, ?, ?)`,
        [userId, amount, newBalance, description, referenceType, referenceId, adminId]
      );

      await conn.commit();
      return { success: true, balance: newBalance, added: amount };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  static async getStats(userId) {
    const [balance] = await db.query('SELECT * FROM credits WHERE user_id = ?', [userId]);
    const [recentTxs] = await db.query(
      'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [userId]
    );
    const [monthlySpend] = await db.query(
      `SELECT SUM(ABS(amount)) as total FROM credit_transactions
       WHERE user_id = ? AND type = 'deduct' AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`, [userId]
    );

    return {
      balance: balance[0]?.balance || 0,
      totalEarned: balance[0]?.total_earned || 0,
      totalSpent: balance[0]?.total_spent || 0,
      monthlySpend: monthlySpend[0]?.total || 0,
      recentTransactions: recentTxs
    };
  }

  static async getTransactions(userId, { page = 1, limit = 20, type = '' } = {}) {
    let where = 'user_id = ?';
    const params = [userId];
    if (type) { where += ' AND type = ?'; params.push(type); }

    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM credit_transactions WHERE ${where}`, params);
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT ct.*, u.full_name as admin_name
       FROM credit_transactions ct
       LEFT JOIN users u ON ct.admin_id = u.id
       WHERE ${where}
       ORDER BY ct.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { transactions: rows, total: countResult[0].total };
  }

  static async listAllTransactions({ page = 1, limit = 20, type = '', userId = null, search = '' } = {}) {
    let where = '1=1';
    const params = [];

    if (userId) { where += ' AND ct.user_id = ?'; params.push(userId); }
    if (type) { where += ' AND ct.type = ?'; params.push(type); }
    if (search) {
      where += ' AND (ct.description LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM credit_transactions ct LEFT JOIN users u ON ct.user_id = u.id WHERE ${where}`, params
    );
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT ct.*, u.username, u.email, u.full_name, u.avatar, admin.username as admin_username
       FROM credit_transactions ct
       LEFT JOIN users u ON ct.user_id = u.id
       LEFT JOIN users admin ON ct.admin_id = admin.id
       WHERE ${where}
       ORDER BY ct.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { transactions: rows, total: countResult[0].total };
  }

  static async clearAllTransactions() {
    await db.query('DELETE FROM credit_transactions');
  }

  // ============ BONUS SYSTEM ============

  /**
   * Internal: grant bonus based on period cooldown.
   * RULE: 1 user = max 1 bonus per period. Threshold = eligibility only.
   * Must be called inside an existing transaction (conn).
   */
  static async _grantBonus(conn, userId, currentBalance) {
    // Read settings
    const [dailyAmt, weeklyAmt, monthlyAmt, dailyOn, weeklyOn, monthlyOn] = await Promise.all([
      AdminSettings.get('credit_bonus_daily'),
      AdminSettings.get('credit_bonus_weekly'),
      AdminSettings.get('credit_bonus_monthly'),
      AdminSettings.get('credit_bonus_daily_enabled'),
      AdminSettings.get('credit_bonus_weekly_enabled'),
      AdminSettings.get('credit_bonus_monthly_enabled'),
    ]);

    const daily   = dailyOn   !== false ? (parseInt(dailyAmt)   || 0) : 0;
    const weekly  = weeklyOn  !== false ? (parseInt(weeklyAmt)  || 0) : 0;
    const monthly = monthlyOn !== false ? (parseInt(monthlyAmt) || 0) : 0;

    // No tier enabled → skip
    if (daily <= 0 && weekly <= 0 && monthly <= 0) return { added: 0, tier: null };

    // Read last bonus grant time
    const [rows] = await conn.query(
      'SELECT last_bonus_granted_at FROM credits WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    const lastBonusAt = rows[0]?.last_bonus_granted_at;

    // Determine which tier is eligible based on period elapsed
    const now = Date.now();
    let bonusAmount = 0;
    let tier = null;

    if (monthly > 0) {
      // Check monthly first (longest period wins)
      if (!lastBonusAt || (now - new Date(lastBonusAt).getTime()) >= 30 * 24 * 60 * 60 * 1000) {
        bonusAmount = monthly;
        tier = 'monthly';
      }
    }
    if (tier === null && weekly > 0) {
      // Check weekly
      if (!lastBonusAt || (now - new Date(lastBonusAt).getTime()) >= 7 * 24 * 60 * 60 * 1000) {
        bonusAmount = weekly;
        tier = 'weekly';
      }
    }
    if (tier === null && daily > 0) {
      // Check daily (shortest period)
      if (!lastBonusAt || (now - new Date(lastBonusAt).getTime()) >= 24 * 60 * 60 * 1000) {
        bonusAmount = daily;
        tier = 'daily';
      }
    }

    if (bonusAmount <= 0) return { added: 0, tier: null };

    // Record: update last_bonus_granted_at to NOW
    await conn.query(
      'UPDATE credits SET last_bonus_granted_at = NOW() WHERE user_id = ?',
      [userId]
    );

    // Add bonus credits (reuse existing balance row)
    const newBal = currentBalance + bonusAmount;
    await conn.query(
      'UPDATE credits SET balance = ?, total_earned = total_earned + ?, updated_at = NOW() WHERE user_id = ?',
      [newBal, bonusAmount, userId]
    );

    // Record transaction
    await conn.query(
      `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type, reference_id)
       VALUES (?, 'add', ?, ?, ?, 'bonus', NULL)`,
      [userId, bonusAmount, newBal, `Credit bonus (${tier})`]
    );

    return { added: bonusAmount, tier, nextBonusAt: this._getNextBonusTime(tier) };
  }

  /**
   * Calculate when the next bonus of this tier will be available.
   */
  static _getNextBonusTime(tier) {
    const ms = { daily: 24*60*60*1000, weekly: 7*24*60*60*1000, monthly: 30*24*60*60*1000 }[tier];
    if (!ms) return null;
    return new Date(Date.now() + ms);
  }

  /**
   * Check if a user is eligible for the bonus feature (verified + bonus enabled).
   */
  static async isBonusEnabled() {
    return (await AdminSettings.get('credit_bonus_enabled')) === true;
  }

  /**
   * Get bonus info for a user (for dashboard display).
   */
  static async getBonusInfo(userId) {
    const enabled = await Credit.isBonusEnabled();
    if (!enabled) return { enabled: false };

    const threshold = parseInt(await AdminSettings.get('credit_bonus_threshold')) || 5;
    const balance = await Credit.getBalance(userId);

    const dailyOn   = await AdminSettings.get('credit_bonus_daily_enabled');
    const weeklyOn  = await AdminSettings.get('credit_bonus_weekly_enabled');
    const monthlyOn = await AdminSettings.get('credit_bonus_monthly_enabled');
    const rawDaily   = parseInt(await AdminSettings.get('credit_bonus_daily'))   || 0;
    const rawWeekly  = parseInt(await AdminSettings.get('credit_bonus_weekly'))  || 0;
    const rawMonthly = parseInt(await AdminSettings.get('credit_bonus_monthly')) || 0;
    const daily   = dailyOn   !== false ? rawDaily   : 0;
    const weekly  = weeklyOn  !== false ? rawWeekly  : 0;
    const monthly = monthlyOn !== false ? rawMonthly : 0;

    // Read last bonus grant time
    const [rows] = await db.query(
      'SELECT last_bonus_granted_at FROM credits WHERE user_id = ?',
      [userId]
    );
    const lastBonusAt = rows[0]?.last_bonus_granted_at;

    let nextTier = null;
    let nextBonusAt = null;
    let isBelowThreshold = balance.balance < threshold;

    // Only show "next bonus" info if user is currently below threshold
    if (isBelowThreshold && lastBonusAt) {
      const now = Date.now();
      const lastMs = new Date(lastBonusAt).getTime();

      if (monthly > 0) {
        const nextMs = lastMs + 30 * 24 * 60 * 60 * 1000;
        if (nextMs > now) { nextTier = 'monthly'; nextBonusAt = new Date(nextMs); }
      }
      if (!nextTier && weekly > 0) {
        const nextMs = lastMs + 7 * 24 * 60 * 60 * 1000;
        if (nextMs > now) { nextTier = 'weekly'; nextBonusAt = new Date(nextMs); }
      }
      if (!nextTier && daily > 0) {
        const nextMs = lastMs + 24 * 60 * 60 * 1000;
        if (nextMs > now) { nextTier = 'daily'; nextBonusAt = new Date(nextMs); }
      }
    }

    return {
      enabled: true,
      threshold,
      tiers: { daily, weekly, monthly },
      lastBonusAt,
      nextTier,
      nextBonusAt,
      isBelowThreshold,
    };
  }
}

module.exports = Credit;
