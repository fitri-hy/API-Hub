const db = require('../config/database');

class RequestLog {
  // Create new log entry
  static async create(data) {
    const [result] = await db.query(
      `INSERT INTO request_logs
       (api_id, route_id, user_id, api_key_id, method, path, query_params, request_body, request_headers,
        response_status, response_body, response_time_ms, ip_address, user_agent,
        credit_cost, is_success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.apiId, data.routeId || null, data.userId, data.apiKeyId || null, data.method, data.path,
       data.queryParams ? JSON.stringify(data.queryParams) : null,
       data.requestBody ? JSON.stringify(data.requestBody).substring(0, 10000) : null,
       data.requestHeaders ? JSON.stringify(data.requestHeaders).substring(0, 5000) : null,
       data.responseStatus || 200,
       data.responseBody ? JSON.stringify(data.responseBody).substring(0, 10000) : null,
       data.responseTimeMs || 0,
       data.ipAddress || null, data.userAgent || null,
       data.creditCost || 0, data.isSuccess !== false ? 1 : 0,
       data.errorMessage || null]
    );
    return result.insertId;
  }

  // List logs for an API
  static async listByApi(apiId, { page = 1, limit = 20 } = {}) {
    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM request_logs WHERE api_id = ?', [apiId]
    );

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT rl.*, u.username
       FROM request_logs rl
       LEFT JOIN users u ON rl.user_id = u.id
       WHERE rl.api_id = ?
       ORDER BY rl.created_at DESC
       LIMIT ? OFFSET ?`,
      [apiId, limit, offset]
    );

    return { logs: rows, total: countResult[0].total };
  }

  // List logs for a user
  static async listByUser(userId, { page = 1, limit = 20, apiId = null, status = '' } = {}) {
    let where = 'rl.user_id = ?';
    const params = [userId];

    if (apiId) {
      where += ' AND rl.api_id = ?';
      params.push(apiId);
    }
    if (status) {
      where += ' AND rl.is_success = ?';
      params.push(status === 'success' ? 1 : 0);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM request_logs rl WHERE ${where}`, params
    );

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT rl.*, a.name as api_name, a.slug as api_slug
       FROM request_logs rl
       LEFT JOIN apis a ON rl.api_id = a.id
       WHERE ${where}
       ORDER BY rl.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { logs: rows, total: countResult[0].total };
  }

  // Admin: list all logs
  static async listAll({ page = 1, limit = 20, search = '', status = '', apiId = null, method = '' } = {}) {
    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (u.username LIKE ? OR a.name LIKE ? OR a.slug LIKE ? OR rl.path LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (status) {
      where += ' AND rl.is_success = ?';
      params.push(status === 'success' ? 1 : 0);
    }
    if (apiId) {
      where += ' AND rl.api_id = ?';
      params.push(apiId);
    }
    if (method) {
      where += ' AND rl.method = ?';
      params.push(method.toUpperCase());
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM request_logs rl
       LEFT JOIN users u ON rl.user_id = u.id
       LEFT JOIN apis a ON rl.api_id = a.id
       WHERE ${where}`, params
    );

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT rl.*, u.username, u.email, u.avatar, a.name as api_name, a.slug as api_slug
       FROM request_logs rl
       LEFT JOIN users u ON rl.user_id = u.id
       LEFT JOIN apis a ON rl.api_id = a.id
       WHERE ${where}
       ORDER BY rl.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { logs: rows, total: countResult[0].total };
  }

  // Get stats
  static async getStats({ userId = null, apiId = null, days = 7 } = {}) {
    let where = 'created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
    const params = [days];

    if (userId) {
      where += ' AND user_id = ?';
      params.push(userId);
    }
    if (apiId) {
      where += ' AND api_id = ?';
      params.push(apiId);
    }

    const [overview] = await db.query(
      `SELECT
        COUNT(*) as total_requests,
        SUM(is_success = 1) as successful,
        SUM(is_success = 0) as failed,
        AVG(response_time_ms) as avg_response_time,
        MIN(response_time_ms) as min_response_time,
        MAX(response_time_ms) as max_response_time,
        SUM(credit_cost) as total_credits_used
       FROM request_logs WHERE ${where}`,
      params
    );

    const [daily] = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as requests, SUM(is_success = 1) as success
       FROM request_logs WHERE ${where}
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      params
    );

    // Status code breakdown
    const [statusCodes] = await db.query(
      `SELECT response_status, COUNT(*) as count
       FROM request_logs WHERE ${where}
       GROUP BY response_status ORDER BY count DESC`,
      params
    );

    // Method breakdown
    const [methods] = await db.query(
      `SELECT method, COUNT(*) as count, AVG(response_time_ms) as avg_time
       FROM request_logs WHERE ${where}
       GROUP BY method ORDER BY count DESC`,
      params
    );

    // Top routes
    const [topRoutes] = await db.query(
      `SELECT ar.path, rl.method, COUNT(*) as count, AVG(rl.response_time_ms) as avg_time
       FROM request_logs rl
       LEFT JOIN api_routes ar ON rl.route_id = ar.id
       WHERE rl.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY rl.route_id, ar.path, rl.method
       ORDER BY count DESC LIMIT 5`,
      [days]
    );

    return { overview: overview[0], daily, statusCodes, methods, topRoutes };
  }

  // Get log detail
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT rl.*, u.username, a.name as api_name, a.slug as api_slug, ar.path as route_path
       FROM request_logs rl
       LEFT JOIN users u ON rl.user_id = u.id
       LEFT JOIN apis a ON rl.api_id = a.id
       LEFT JOIN api_routes ar ON rl.route_id = ar.id
       WHERE rl.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  static async clearAll() {
    await db.query('DELETE FROM request_logs');
    await db.query(
      'UPDATE apis SET total_requests = 0, successful_requests = 0, failed_requests = 0'
    );
  }
}

module.exports = RequestLog;
