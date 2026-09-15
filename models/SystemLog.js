const db = require('../config/database');

class SystemLog {
  static async create(data) {
    await db.query(
      `INSERT INTO system_logs (user_id, action, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [data.userId || null, data.action,
       data.details ? JSON.stringify(data.details) : null,
       data.ipAddress || null, data.userAgent || null]
    );
  }

  static async list({ page = 1, limit = 30, action = '', userId = null } = {}) {
    let where = '1=1';
    const params = [];

    if (action) {
      where += ' AND sl.action = ?';
      params.push(action);
    }
    if (userId) {
      where += ' AND sl.user_id = ?';
      params.push(userId);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM system_logs sl WHERE ${where}`, params
    );

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT sl.*, u.username, u.email, u.avatar
       FROM system_logs sl
       LEFT JOIN users u ON sl.user_id = u.id
       WHERE ${where}
       ORDER BY sl.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { logs: rows, total: countResult[0].total };
  }

  static async getRecent(limit = 10) {
    const [rows] = await db.query(
      `SELECT sl.*, u.username, u.avatar
       FROM system_logs sl
       LEFT JOIN users u ON sl.user_id = u.id
       ORDER BY sl.created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows;
  }

  static async getRecent(limit = 10) {
    const [rows] = await db.query(
      `SELECT sl.*, u.username
       FROM system_logs sl
       LEFT JOIN users u ON sl.user_id = u.id
       ORDER BY sl.created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows;
  }

  static async clearAll() {
    await db.query('DELETE FROM system_logs');
  }
}

module.exports = SystemLog;
