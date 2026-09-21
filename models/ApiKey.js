const db = require('../config/database');
const crypto = require('crypto');

class ApiKey {
  // Find by ID
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT ak.*, u.username, u.email
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       WHERE ak.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Find by key value
  static async findByKey(keyValue) {
    const [rows] = await db.query(
      `SELECT ak.*, u.id as uid, u.username, u.email, u.full_name, u.is_active as user_active,
              u.package_id, u.custom_rate_limit,
              p.name as package_name, p.rate_limit_per_minute as package_rate_limit,
              c.balance as credit_balance
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       LEFT JOIN packages p ON u.package_id = p.id
       LEFT JOIN credits c ON u.id = c.user_id
       WHERE ak.key_value = ? AND ak.is_active = 1 AND u.is_active = 1 AND u.deleted_at IS NULL`,
      [keyValue]
    );
    return rows[0] || null;
  }

  // List all keys for a user
  static async listByUser(userId) {
    const [rows] = await db.query(
      `SELECT ak.*,
              (SELECT COUNT(*) FROM request_logs WHERE api_key_id = ak.id) as total_requests,
              (SELECT COUNT(*) FROM request_logs WHERE api_key_id = ak.id AND is_success = 1) as success_requests
       FROM api_keys ak
       WHERE ak.user_id = ?
       ORDER BY ak.created_at DESC`,
      [userId]
    );
    return rows;
  }

  // List all keys (admin)
  static async listAll() {
    const [rows] = await db.query(
      `SELECT ak.*, u.username, u.email
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       ORDER BY ak.created_at DESC`
    );
    return rows;
  }

  // Count keys for a user
  static async countByUser(userId) {
    const [rows] = await db.query('SELECT COUNT(*) as total FROM api_keys WHERE user_id = ?', [userId]);
    return rows[0].total;
  }

  // Create new API key
  static async create(userId, name = 'Default Key', creditLimit = 0) {
    const keyValue = 'sgw_live_' + crypto.randomBytes(24).toString('hex');

    const [result] = await db.query(
      `INSERT INTO api_keys (user_id, name, key_value, credit_limit)
       VALUES (?, ?, ?, ?)`,
      [userId, name, keyValue, creditLimit]
    );

    return this.findById(result.insertId);
  }

  // Update API key
  static async update(id, data) {
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.creditLimit !== undefined) { fields.push('credit_limit = ?'); values.push(data.creditLimit); }
    if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive); }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await db.query(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  // Delete API key
  static async delete(id) {
    await db.query('DELETE FROM rate_limits WHERE api_key_id = ?', [id]);
    await db.query('DELETE FROM api_keys WHERE id = ?', [id]);
  }

  // Deduct credit from API key (returns success + remaining)
  static async deductCredits(id, amount, conn = null) {
    const executor = conn || db;
    const [result] = await executor.query(
      `UPDATE api_keys SET credits_used = credits_used + ?, credits_used_total = credits_used_total + ?,
       last_used_at = NOW() WHERE id = ?`,
      [amount, amount, id]
    );
    return result.affectedRows > 0;
  }

  // Reset credits used (monthly reset or manual)
  static async resetCredits(id) {
    await db.query('UPDATE api_keys SET credits_used = 0 WHERE id = ?', [id]);
  }

  // Get API key usage stats
  static async getStats(id) {
    const [rows] = await db.query(
      `SELECT ak.*,
              (SELECT COUNT(*) FROM request_logs WHERE api_key_id = ak.id) as total_requests,
              (SELECT COUNT(*) FROM request_logs WHERE api_key_id = ak.id AND is_success = 1) as success_requests,
              (SELECT COUNT(*) FROM request_logs WHERE api_key_id = ak.id AND is_success = 0) as failed_requests,
              (SELECT AVG(response_time_ms) FROM request_logs WHERE api_key_id = ak.id) as avg_response_time
       FROM api_keys ak WHERE ak.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Get daily usage for the last N days
  static async getDailyUsage(id, days = 7) {
    const [rows] = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as requests
       FROM request_logs
       WHERE api_key_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [id, days]
    );
    return rows;
  }

  // Get weekly usage for the last N weeks
  static async getWeeklyUsage(id, weeks = 4) {
    const [rows] = await db.query(
      `SELECT YEARWEEK(created_at, 1) as week, MIN(DATE(created_at)) as week_start,
              COUNT(*) as requests
       FROM request_logs
       WHERE api_key_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? WEEK)
       GROUP BY YEARWEEK(created_at, 1)
       ORDER BY week ASC`,
      [id, weeks]
    );
    return rows;
  }

  // Get monthly usage for the last N months
  static async getMonthlyUsage(id, months = 6) {
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as requests
       FROM request_logs
       WHERE api_key_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month ASC`,
      [id, months]
    );
    return rows;
  }
}

module.exports = ApiKey;
