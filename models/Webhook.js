const db = require('../config/database');
const crypto = require('crypto');

// ============================================================
// Available webhook events
// ============================================================
const WEBHOOK_EVENTS = {
  admin: [
    { name: 'transaction.created', label: 'Transaction Created', description: 'When a user submits a new transaction' },
    { name: 'transaction.approved', label: 'Transaction Approved', description: 'When a transaction is approved by admin' },
    { name: 'transaction.rejected', label: 'Transaction Rejected', description: 'When a transaction is rejected by admin' },
    { name: 'transaction.proof_uploaded', label: 'Payment Proof Uploaded', description: 'When a user uploads payment proof' },
    { name: 'user.registered', label: 'User Registered', description: 'When a new user registers' },
    { name: 'user.verified', label: 'User Verified', description: 'When a user account is verified' },
    { name: 'user.verification_rejected', label: 'Verification Rejected', description: 'When a verification request is rejected' },
    { name: 'credit.added', label: 'Credit Added', description: 'When credits are added to a user account' },
    { name: 'credit.deducted', label: 'Credit Deducted', description: 'When credits are deducted from a user account' },
    { name: 'package.changed', label: 'Package Changed', description: 'When a user package is changed' },
    { name: 'api_key.created', label: 'API Key Created', description: 'When a new API key is created' },
    { name: 'api_key.deleted', label: 'API Key Deleted', description: 'When an API key is deleted' },
    { name: 'system.maintenance', label: 'System Maintenance', description: 'When maintenance mode is toggled' },
    { name: 'system.alert', label: 'System Alert', description: 'System-level alerts and warnings' },
  ],
  user: [
    { name: 'transaction.created', label: 'Transaction Created', description: 'When you submit a new transaction' },
    { name: 'transaction.approved', label: 'Transaction Approved', description: 'When your transaction is approved' },
    { name: 'transaction.rejected', label: 'Transaction Rejected', description: 'When your transaction is rejected' },
    { name: 'credit.changed', label: 'Credit Changed', description: 'When your credit balance changes' },
    { name: 'package.changed', label: 'Package Changed', description: 'When your package is updated' },
    { name: 'api_key.created', label: 'API Key Created', description: 'When you create a new API key' },
    { name: 'api_key.deleted', label: 'API Key Deleted', description: 'When you delete an API key' },
    { name: 'profile.updated', label: 'Profile Updated', description: 'When your profile is updated' },
    { name: 'verification.status_changed', label: 'Verification Status Changed', description: 'When your verification status changes' },
  ]
};

class Webhook {
  // ============================================================
  // CRUD
  // ============================================================

  static async findById(id) {
    const [rows] = await db.query(
      `SELECT w.*, u.username, u.email
       FROM webhooks w
       JOIN users u ON w.user_id = u.id
       WHERE w.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  static async listByUser(userId, { page = 1, limit = 20, search = '' } = {}) {
    let where = 'w.user_id = ?';
    const params = [userId];

    if (search) {
      where += ' AND (w.name LIKE ? OR w.url LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM webhooks w WHERE ${where}`,
      params
    );
    const total = countResult[0].total;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id) as total_deliveries,
              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'success') as success_deliveries,
              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'failed') as failed_deliveries,
              (SELECT wl.created_at FROM webhook_logs wl WHERE wl.webhook_id = w.id ORDER BY wl.created_at DESC LIMIT 1) as last_triggered_at
       FROM webhooks w
       WHERE ${where}
       ORDER BY w.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { webhooks: rows, total };
  }

  static async listAll({ page = 1, limit = 20, role = '', search = '' } = {}) {
    let where = '1=1';
    const params = [];

    if (role) { where += ' AND w.role = ?'; params.push(role); }
    if (search) {
      where += ' AND (w.name LIKE ? OR w.url LIKE ? OR u.username LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM webhooks w JOIN users u ON w.user_id = u.id WHERE ${where}`,
      params
    );
    const total = countResult[0].total;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT w.*, u.username, u.email,
              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id) as total_deliveries,
              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'success') as success_deliveries,
              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'failed') as failed_deliveries,
              (SELECT wl.created_at FROM webhook_logs wl WHERE wl.webhook_id = w.id ORDER BY wl.created_at DESC LIMIT 1) as last_triggered_at
       FROM webhooks w
       JOIN users u ON w.user_id = u.id
       WHERE ${where}
       ORDER BY w.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { webhooks: rows, total };
  }

  static async create(userId, { name, url, events, role = 'user', customHeaders = null, apiKeyId = null, authType = 'header', authHeaderName = 'X-API-Key', authParamName = 'api_key' }) {
    const secret = 'whsec_' + crypto.randomBytes(32).toString('hex');

    const [result] = await db.query(
      `INSERT INTO webhooks (user_id, role, name, url, secret, events, custom_headers, api_key_id, auth_type, auth_header_name, auth_param_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, role, name, url, secret,
        JSON.stringify(events),
        customHeaders ? JSON.stringify(customHeaders) : null,
        apiKeyId, authType, authHeaderName, authParamName
      ]
    );

    return this.findById(result.insertId);
  }

  static async update(id, data) {
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.url !== undefined) { fields.push('url = ?'); values.push(data.url); }
    if (data.events !== undefined) { fields.push('events = ?'); values.push(JSON.stringify(data.events)); }
    if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }
    if (data.customHeaders !== undefined) { fields.push('custom_headers = ?'); values.push(data.customHeaders ? JSON.stringify(data.customHeaders) : null); }
    if (data.apiKeyId !== undefined) { fields.push('api_key_id = ?'); values.push(data.apiKeyId); }
    if (data.authType !== undefined) { fields.push('auth_type = ?'); values.push(data.authType); }
    if (data.authHeaderName !== undefined) { fields.push('auth_header_name = ?'); values.push(data.authHeaderName); }
    if (data.authParamName !== undefined) { fields.push('auth_param_name = ?'); values.push(data.authParamName); }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await db.query(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  static async delete(id) {
    await db.query('DELETE FROM webhook_logs WHERE webhook_id = ?', [id]);
    await db.query('DELETE FROM webhooks WHERE id = ?', [id]);
  }

  static async rotateSecret(id) {
    const newSecret = 'whsec_' + crypto.randomBytes(32).toString('hex');
    await db.query('UPDATE webhooks SET secret = ? WHERE id = ?', [newSecret, id]);
    return this.findById(id);
  }

  // ============================================================
  // Find active webhooks by event
  // ============================================================

  static async findByEvent(eventName, role = null) {
    let where = 'w.is_active = 1';
    const params = [];

    if (role) {
      where += ' AND w.role = ?';
      params.push(role);
    }

    // MySQL JSON_CONTAINS check
    where += ` AND JSON_CONTAINS(w.events, ?)`;
    params.push(JSON.stringify(eventName));

    const [rows] = await db.query(
      `SELECT w.*, u.username, u.email
       FROM webhooks w
       JOIN users u ON w.user_id = u.id
       WHERE ${where}`,
      params
    );

    return rows;
  }

  // ============================================================
  // DISPATCH - Send webhook
  // ============================================================

  static async dispatch(eventName, payload, role = null) {
    const webhooks = await this.findByEvent(eventName, role);

    for (const webhook of webhooks) {
      this.deliver(webhook, eventName, payload).catch(err => {
        console.error(`[Webhook] Delivery error for webhook #${webhook.id}:`, err.message);
      });
    }

    return webhooks.length;
  }

  static async deliver(webhook, eventName, payload) {
    const startTime = Date.now();

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': eventName,
      'X-Webhook-Delivery': crypto.randomUUID(),
      'X-Webhook-Timestamp': Math.floor(Date.now() / 1000).toString(),
    };

    // Add API key authentication
    let fullUrl = webhook.url;
    if (webhook.api_key_id) {
      const [keyRows] = await db.query('SELECT key_value FROM api_keys WHERE id = ?', [webhook.api_key_id]);
      if (keyRows.length > 0) {
        const keyValue = keyRows[0].key_value;
        if (webhook.auth_type === 'header') {
          headers[webhook.auth_header_name || 'X-API-Key'] = keyValue;
        } else {
          const separator = fullUrl.includes('?') ? '&' : '?';
          fullUrl += `${separator}${webhook.auth_param_name || 'api_key'}=${keyValue}`;
        }
      }
    }

    // Add custom headers
    if (webhook.custom_headers) {
      const custom = typeof webhook.custom_headers === 'string' ? JSON.parse(webhook.custom_headers) : webhook.custom_headers;
      Object.assign(headers, custom);
    }

    // Build body
    const body = JSON.stringify({
      event: eventName,
      timestamp: new Date().toISOString(),
      data: payload
    });

    // HMAC signature
    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
    headers['X-Webhook-Signature'] = `sha256=${signature}`;

    // Create log entry
    const [logResult] = await db.query(
      `INSERT INTO webhook_logs (webhook_id, event_name, payload, status)
       VALUES (?, ?, ?, 'pending')`,
      [webhook.id, eventName, JSON.stringify({ event: eventName, timestamp: new Date().toISOString(), data: payload })]
    );
    const logId = logResult.insertId;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });

      clearTimeout(timeout);

      const duration = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      await db.query(
        `UPDATE webhook_logs SET status = ?, response_status_code = ?, response_body = ?, duration_ms = ?
         WHERE id = ?`,
        [
          response.ok ? 'success' : 'failed',
          response.status,
          responseBody.substring(0, 10000), // Limit response body size
          duration,
          logId
        ]
      );
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err.name === 'AbortError' ? 'Request timeout (10s)' : err.message;

      await db.query(
        `UPDATE webhook_logs SET status = 'failed', error_message = ?, duration_ms = ?
         WHERE id = ?`,
        [errorMsg, duration, logId]
      );
    }
  }

  // ============================================================
  // LOGS
  // ============================================================

  static async getLogs(webhookId, { page = 1, limit = 20 } = {}) {
    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM webhook_logs WHERE webhook_id = ?',
      [webhookId]
    );
    const total = countResult[0].total;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [webhookId, limit, offset]
    );

    return { logs: rows, total };
  }

  static async getRecentLogs({ page = 1, limit = 20, webhookId = null, status = '', event = '' } = {}) {
    let where = '1=1';
    const params = [];

    if (webhookId) { where += ' AND wl.webhook_id = ?'; params.push(webhookId); }
    if (status) { where += ' AND wl.status = ?'; params.push(status); }
    if (event) { where += ' AND wl.event_name = ?'; params.push(event); }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM webhook_logs wl WHERE ${where}`,
      params
    );
    const total = countResult[0].total;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT wl.*, w.name as webhook_name, w.url as webhook_url, u.username
       FROM webhook_logs wl
       JOIN webhooks w ON wl.webhook_id = w.id
       JOIN users u ON w.user_id = u.id
       WHERE ${where}
       ORDER BY wl.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { logs: rows, total };
  }

  // ============================================================
  // CLEAR LOGS
  // ============================================================

  static async clearLogs(webhookId) {
    await db.query('DELETE FROM webhook_logs WHERE webhook_id = ?', [webhookId]);
  }

  static async clearAllLogs() {
    await db.query('DELETE FROM webhook_logs');
  }

  static async clearUserLogs(userId) {
    await db.query(
      'DELETE wl FROM webhook_logs wl JOIN webhooks w ON wl.webhook_id = w.id WHERE w.user_id = ?',
      [userId]
    );
  }

  static async getUserRecentLogs(userId, { page = 1, limit = 20, status = '', event = '' } = {}) {
    let where = 'w.user_id = ?';
    const params = [userId];

    if (status) { where += ' AND wl.status = ?'; params.push(status); }
    if (event) { where += ' AND wl.event_name = ?'; params.push(event); }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM webhook_logs wl JOIN webhooks w ON wl.webhook_id = w.id WHERE ${where}`,
      params
    );
    const total = countResult[0].total;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT wl.*, w.name as webhook_name, w.url as webhook_url
       FROM webhook_logs wl
       JOIN webhooks w ON wl.webhook_id = w.id
       WHERE ${where}
       ORDER BY wl.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { logs: rows, total };
  }

  // ============================================================
  // EVENTS LIST
  // ============================================================

  static getEvents(role) {
    return WEBHOOK_EVENTS[role] || [];
  }

  static getAllEvents() {
    return WEBHOOK_EVENTS;
  }

  // ============================================================
  // STATS
  // ============================================================

  static async getStats(userId = null) {
    let where = userId ? 'WHERE w.user_id = ?' : '';
    const params = userId ? [userId] : [];

    const [rows] = await db.query(
      `SELECT
        COUNT(DISTINCT w.id) as total_webhooks,
        COUNT(DISTINCT CASE WHEN w.is_active = 1 THEN w.id END) as active_webhooks,
        (SELECT COUNT(*) FROM webhook_logs wl JOIN webhooks w2 ON wl.webhook_id = w2.id ${userId ? 'WHERE w2.user_id = ?' : ''}) as total_deliveries,
        (SELECT COUNT(*) FROM webhook_logs wl JOIN webhooks w2 ON wl.webhook_id = w2.id WHERE wl.status = 'success' ${userId ? 'AND w2.user_id = ?' : ''}) as successful_deliveries,
        (SELECT COUNT(*) FROM webhook_logs wl JOIN webhooks w2 ON wl.webhook_id = w2.id WHERE wl.status = 'failed' ${userId ? 'AND w2.user_id = ?' : ''}) as failed_deliveries
       FROM webhooks w ${where}`,
      userId ? [userId, userId, userId, userId] : []
    );

    return rows[0] || {};
  }
}

module.exports = Webhook;
module.exports.WEBHOOK_EVENTS = WEBHOOK_EVENTS;
