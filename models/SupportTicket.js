const db = require('../config/database');

class SupportTicket {
  // ============================================================
  // TICKET NUMBER GENERATOR
  // ============================================================

  static async generateTicketNumber() {
    const [rows] = await db.query(
      `SELECT COUNT(*) as cnt FROM support_tickets WHERE DATE(created_at) = CURDATE()`
    );
    const count = (rows[0]?.cnt || 0) + 1;
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `TKT-${datePart}-${String(count).padStart(4, '0')}`;
  }

  // ============================================================
  // CORE CRUD
  // ============================================================

  /**
   * Create a new support ticket
   */
  static async create(data) {
    const ticketNumber = await this.generateTicketNumber();

    const [result] = await db.query(
      `INSERT INTO support_tickets (
        user_id, ticket_number, subject, description, category,
        priority, related_api_id, api_endpoint, error_message,
        reproduction_steps, browser_info, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.user_id,
        ticketNumber,
        data.subject,
        data.description,
        data.category || 'technical',
        data.priority || 'medium',
        data.related_api_id || null,
        data.api_endpoint || null,
        data.error_message || null,
        data.reproduction_steps || null,
        data.browser_info || null,
        data.tags || null
      ]
    );

    // Create initial message from user
    await this.addMessage({
      ticket_id: result.insertId,
      sender_id: data.user_id,
      sender_role: 'user',
      message: data.description
    });

    return { id: result.insertId, ticket_number: ticketNumber, subject: data.subject };
  }

  /**
   * Find ticket by ID with user info
   */
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT t.*,
              u.username, u.email, u.full_name, u.avatar, u.uuid as user_uuid,
              a.username as assigned_username, a.full_name as assigned_name
       FROM support_tickets t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       WHERE t.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Find ticket by ticket number
   */
  static async findByNumber(ticketNumber) {
    const [rows] = await db.query(
      `SELECT t.*,
              u.username, u.email, u.full_name, u.avatar
       FROM support_tickets t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.ticket_number = ?`,
      [ticketNumber]
    );
    return rows[0] || null;
  }

  /**
   * Update ticket fields
   */
  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = [
      'status', 'priority', 'assigned_to', 'admin_notes',
      'resolved_at', 'closed_at', 'tags', 'category'
    ];

    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await db.query(`UPDATE support_tickets SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  /**
   * Soft close a ticket
   */
  static async close(id) {
    await db.query(
      `UPDATE support_tickets SET status = 'closed', closed_at = NOW() WHERE id = ?`,
      [id]
    );
    return this.findById(id);
  }

  /**
   * Reopen a ticket
   */
  static async reopen(id) {
    await db.query(
      `UPDATE support_tickets SET status = 'open', closed_at = NULL WHERE id = ?`,
      [id]
    );
    return this.findById(id);
  }

  /**
   * Delete a ticket and all its messages
   */
  static async delete(id) {
    await db.query(`DELETE FROM ticket_messages WHERE ticket_id = ?`, [id]);
    await db.query(`DELETE FROM support_tickets WHERE id = ?`, [id]);
    return true;
  }

  // ============================================================
  // MESSAGES
  // ============================================================

  /**
   * Add a message to a ticket
   */
  static async addMessage(data) {
    const [result] = await db.query(
      `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, message, is_internal_note, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.ticket_id,
        data.sender_id,
        data.sender_role || 'user',
        data.message,
        data.is_internal_note || 0,
        data.attachments ? JSON.stringify(data.attachments) : null
      ]
    );

    // Update ticket updated_at
    await db.query(
      `UPDATE support_tickets SET updated_at = NOW() WHERE id = ?`,
      [data.ticket_id]
    );

    return { id: result.insertId };
  }

  /**
   * Get messages for a ticket
   */
  static async getMessages(ticketId, { includeInternal = false } = {}) {
    let where = `tm.ticket_id = ?`;
    const params = [ticketId];

    if (!includeInternal) {
      where += ` AND tm.is_internal_note = 0`;
    }

    const [rows] = await db.query(
      `SELECT tm.*,
              u.username, u.full_name, u.avatar
       FROM ticket_messages tm
       LEFT JOIN users u ON tm.sender_id = u.id
       WHERE ${where}
       ORDER BY tm.created_at ASC`,
      params
    );

    return rows;
  }

  /**
   * Mark messages as read
   */
  static async markMessagesRead(ticketId, role) {
    await db.query(
      `UPDATE ticket_messages SET read_at = NOW()
       WHERE ticket_id = ? AND sender_role != ? AND read_at IS NULL`,
      [ticketId, role]
    );
    return true;
  }

  /**
   * Get unread message count for a ticket
   */
  static async getUnreadCount(ticketId, role) {
    const [rows] = await db.query(
      `SELECT COUNT(*) as cnt FROM ticket_messages
       WHERE ticket_id = ? AND sender_role != ? AND read_at IS NULL`,
      [ticketId, role]
    );
    return rows[0]?.cnt || 0;
  }

  // ============================================================
  // LISTING / PAGINATION
  // ============================================================

  /**
   * List tickets for a specific user
   */
  static async listByUser(userId, { page = 1, limit = 20, status, category, search } = {}) {
    let where = 't.user_id = ?';
    const params = [userId];

    if (status) {
      where += ' AND t.status = ?';
      params.push(status);
    }
    if (category) {
      where += ' AND t.category = ?';
      params.push(category);
    }
    if (search) {
      where += ' AND (t.subject LIKE ? OR t.ticket_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM support_tickets t WHERE ${where}`,
      params
    );
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.read_at IS NULL AND tm.sender_role = 'admin') as unread_count,
              (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) as message_count
       FROM support_tickets t
       WHERE ${where}
       ORDER BY t.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { tickets: rows, total };
  }

  /**
   * List all tickets (admin) with filters
   */
  static async listAll({ page = 1, limit = 20, status, category, priority, assigned_to, search } = {}) {
    let where = '1=1';
    const params = [];

    if (status) {
      where += ' AND t.status = ?';
      params.push(status);
    }
    if (category) {
      where += ' AND t.category = ?';
      params.push(category);
    }
    if (priority) {
      where += ' AND t.priority = ?';
      params.push(priority);
    }
    if (assigned_to) {
      if (assigned_to === 'unassigned') {
        where += ' AND t.assigned_to IS NULL';
      } else {
        where += ' AND t.assigned_to = ?';
        params.push(assigned_to);
      }
    }
    if (search) {
      where += ' AND (t.subject LIKE ? OR t.ticket_number LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM support_tickets t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE ${where}`,
      params
    );
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT t.*,
              u.username, u.email, u.full_name, u.avatar, u.uuid as user_uuid,
              a.username as assigned_username, a.full_name as assigned_name,
              (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.read_at IS NULL AND tm.sender_role = 'user') as unread_count,
              (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) as message_count
       FROM support_tickets t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       WHERE ${where}
       ORDER BY
         FIELD(t.priority, 'urgent', 'high', 'medium', 'low'),
         t.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { tickets: rows, total };
  }

  // ============================================================
  // STATS
  // ============================================================

  /**
   * Get ticket stats for admin dashboard
   */
  static async getStats() {
    const [total] = await db.query('SELECT COUNT(*) as c FROM support_tickets');
    const [open] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE status IN ('open','in_progress','waiting_reply')");
    const [resolved] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE status = 'resolved'");
    const [closed] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE status = 'closed'");
    const [today] = await db.query('SELECT COUNT(*) as c FROM support_tickets WHERE DATE(created_at) = CURDATE()');
    const [urgent] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE priority = 'urgent' AND status NOT IN ('resolved','closed')");

    const [byCategory] = await db.query(
      `SELECT category, COUNT(*) as count FROM support_tickets GROUP BY category ORDER BY count DESC`
    );
    const [byStatus] = await db.query(
      `SELECT status, COUNT(*) as count FROM support_tickets GROUP BY status`
    );

    return {
      total: total[0].c,
      open: open[0].c,
      resolved: resolved[0].c,
      closed: closed[0].c,
      today: today[0].c,
      urgent: urgent[0].c,
      byCategory,
      byStatus
    };
  }

  /**
   * Get user's ticket stats
   */
  static async getUserStats(userId) {
    const [total] = await db.query('SELECT COUNT(*) as c FROM support_tickets WHERE user_id = ?', [userId]);
    const [open] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE user_id = ? AND status IN ('open','in_progress','waiting_reply')", [userId]);
    const [resolved] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE user_id = ? AND status = 'resolved'", [userId]);
    const [closed] = await db.query("SELECT COUNT(*) as c FROM support_tickets WHERE user_id = ? AND status = 'closed'", [userId]);

    return {
      total: total[0].c,
      open: open[0].c,
      resolved: resolved[0].c,
      closed: closed[0].c
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  static getStatusLabel(status) {
    const labels = {
      open: 'Open',
      in_progress: 'In Progress',
      waiting_reply: 'Waiting Reply',
      resolved: 'Resolved',
      closed: 'Closed'
    };
    return labels[status] || status;
  }

  static getStatusColor(status) {
    const colors = {
      open: 'bg-blue-50 text-blue-600 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
      in_progress: 'bg-amber-50 text-amber-600 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
      waiting_reply: 'bg-purple-50 text-purple-600 border border-purple-200/70 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20',
      resolved: 'bg-emerald-50 text-emerald-600 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
      closed: 'bg-gray-100 text-gray-500 border border-gray-200/70 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700/70'
    };
    return colors[status] || colors.open;
  }

  static getPriorityLabel(priority) {
    const labels = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    return labels[priority] || priority;
  }

  static getPriorityColor(priority) {
    const colors = {
      low: 'bg-gray-100 text-gray-500 border border-gray-200/70 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700/70',
      medium: 'bg-blue-50 text-blue-600 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
      high: 'bg-amber-50 text-amber-600 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
      urgent: 'bg-rose-50 text-rose-600 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
    };
    return colors[priority] || colors.medium;
  }

  static getCategoryLabel(category) {
    const labels = {
      technical: 'Technical Issue',
      feature_request: 'Feature Request',
      bug_report: 'Bug Report',
      billing: 'Billing',
      account: 'Account',
      api_issue: 'API Issue',
      other: 'Other'
    };
    return labels[category] || category;
  }

  static getCategoryIcon(category) {
    const icons = {
      technical: 'wrench',
      feature_request: 'lightbulb',
      bug_report: 'bug',
      billing: 'credit-card',
      account: 'user',
      api_issue: 'code',
      other: 'help-circle'
    };
    return icons[category] || 'help-circle';
  }
}

module.exports = SupportTicket;
