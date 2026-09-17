const db = require('../config/database');

class Transaction {
  // Find by ID with user and package info
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT t.*, u.username, u.email, u.full_name, u.avatar,
              p.name as package_name, p.credits_included, p.rate_limit_per_minute as package_rate_limit,
              reviewer.username as reviewed_by_name
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN packages p ON t.package_id = p.id
       LEFT JOIN users reviewer ON t.reviewed_by = reviewer.id
       WHERE t.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // List all transactions with filters
  static async listAll({ page = 1, limit = 20, status = '', search = '' } = {}) {
    let where = '1=1';
    const params = [];

    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM transactions t JOIN users u ON t.user_id = u.id WHERE ${where}`,
      params
    );
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT t.*, u.username, u.email, u.full_name, u.avatar,
              p.name as package_name,
              reviewer.username as reviewed_by_name
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN packages p ON t.package_id = p.id
       LEFT JOIN users reviewer ON t.reviewed_by = reviewer.id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { transactions: rows, total };
  }

  // List transactions for a specific user
  static async listByUser(userId, { page = 1, limit = 20, status = '' } = {}) {
    let where = 't.user_id = ?';
    const params = [userId];

    if (status) { where += ' AND t.status = ?'; params.push(status); }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM transactions t WHERE ${where}`,
      params
    );
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT t.*, u.avatar, p.name as package_name
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN packages p ON t.package_id = p.id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { transactions: rows, total };
  }

  // Create new transaction
  static async create(data) {
    const [result] = await db.query(
      `INSERT INTO transactions (user_id, package_id, type, credits_requested, rate_limit_per_minute, total_price, payment_proof, payment_method, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.user_id, data.package_id || null, data.type, data.credits_requested, data.rate_limit_per_minute, data.total_price, data.payment_proof || null, data.payment_method || null, data.notes || null]
    );
    return this.findById(result.insertId);
  }

  // Approve transaction
  static async approve(id, adminId, adminNote = '') {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [txns] = await conn.query('SELECT * FROM transactions WHERE id = ? AND status = "pending" FOR UPDATE', [id]);
      if (!txns.length) {
        await conn.rollback();
        return { success: false, message: 'Transaction not found or already processed' };
      }

      const txn = txns[0];

      // Update transaction status
      await conn.query(
        'UPDATE transactions SET status = "approved", reviewed_by = ?, reviewed_at = NOW(), admin_note = ? WHERE id = ?',
        [adminId, adminNote, id]
      );

      // Update user's package
      if (txn.type === 'standard_package' && txn.package_id) {
        // Standard package: set package_id directly
        await conn.query('UPDATE users SET package_id = ?, custom_rate_limit = NULL WHERE id = ?', [txn.package_id, txn.user_id]);
      } else if (txn.type === 'custom_package') {
        // Custom package: find or create 'Custom Package' entry, set custom_rate_limit
        let [customPkg] = await conn.query('SELECT id FROM packages WHERE slug = ?', ['custom']);
        if (customPkg.length === 0) {
          // Create the Custom Package entry if it doesn't exist
          const [ins] = await conn.query(
            `INSERT INTO packages (slug, name, description, price, credits_included, rate_limit_per_minute, is_active)
             VALUES ('custom', 'Custom Package', 'User-defined custom package', 0, 0, 50, 1)`
          );
          customPkg = [{ id: ins.insertId }];
        }
        await conn.query(
          'UPDATE users SET package_id = ?, custom_rate_limit = ? WHERE id = ?',
          [customPkg[0].id, txn.rate_limit_per_minute, txn.user_id]
        );
      }

      // Add credits to user wallet
      const [credits] = await conn.query('SELECT * FROM credits WHERE user_id = ? FOR UPDATE', [txn.user_id]);
      const currentBalance = credits.length > 0 ? credits[0].balance : 0;
      const newBalance = currentBalance + txn.credits_requested;

      if (credits.length > 0) {
        await conn.query(
          'UPDATE credits SET balance = ?, total_earned = total_earned + ?, updated_at = NOW() WHERE user_id = ?',
          [newBalance, txn.credits_requested, txn.user_id]
        );
      } else {
        await conn.query(
          'INSERT INTO credits (user_id, balance, total_earned, total_spent) VALUES (?, ?, ?, 0)',
          [txn.user_id, txn.credits_requested, txn.credits_requested]
        );
      }

      // Log credit transaction
      const description = txn.type === 'standard_package'
        ? `Purchase package: ${txn.credits_requested} credits`
        : `Custom package: ${txn.credits_requested} credits + ${txn.rate_limit_per_minute} req/min`;

      await conn.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type, reference_id)
         VALUES (?, 'add', ?, ?, ?, 'transaction', ?)`,
        [txn.user_id, txn.credits_requested, newBalance, description, id]
      );

      await conn.commit();
      return { success: true, message: 'Transaction approved' };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Reject transaction
  static async reject(id, adminId, adminNote = '') {
    const [result] = await db.query(
      'UPDATE transactions SET status = "rejected", reviewed_by = ?, reviewed_at = NOW(), admin_note = ? WHERE id = ? AND status = "pending"',
      [adminId, adminNote, id]
    );
    return result.affectedRows > 0;
  }

  // Calculate custom package price
  static async calculateCustomPrice(credits, rateLimitPerMinute) {
    const creditPrice = 50; // rp50 per credit (from admin settings, can be updated)
    const creditCost = credits * creditPrice;

    // Get rate limit pricing from admin settings
    const [settings] = await db.query(
      `SELECT setting_key, setting_value FROM admin_settings
       WHERE setting_key IN ('custom_package_rate_limit_min', 'custom_package_rate_limit_max',
                             'custom_package_rate_limit_step', 'custom_package_rate_limit_price_per_step')`
    );

    let rateLimitMin = 50;
    let rateLimitMax = 500;
    let rateLimitStep = 50;
    let rateLimitPricePerStep = 5000;

    settings.forEach(s => {
      if (s.setting_key === 'custom_package_rate_limit_min') rateLimitMin = parseInt(s.setting_value);
      if (s.setting_key === 'custom_package_rate_limit_max') rateLimitMax = parseInt(s.setting_value);
      if (s.setting_key === 'custom_package_rate_limit_step') rateLimitStep = parseInt(s.setting_value);
      if (s.setting_key === 'custom_package_rate_limit_price_per_step') rateLimitPricePerStep = parseInt(s.setting_value);
    });

    // Calculate rate limit cost (base is min, each step adds price)
    const stepsAboveMin = Math.max(0, Math.ceil((rateLimitPerMinute - rateLimitMin) / rateLimitStep));
    const rateLimitCost = stepsAboveMin * rateLimitPricePerStep;

    const totalCost = creditCost + rateLimitCost;

    return {
      credits,
      creditPrice,
      creditCost,
      rateLimitPerMinute,
      rateLimitMin,
      rateLimitMax,
      rateLimitStep,
      rateLimitPricePerStep,
      rateLimitCost,
      totalCost,
      formattedTotal: new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(totalCost)
    };
  }
}

module.exports = Transaction;