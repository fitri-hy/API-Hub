const db = require('../config/database');

// Cache for notifications_enabled setting (avoid per-request DB lookup)
let _notifEnabledCache = null;
let _notifEnabledCacheTime = 0;
const NOTIF_CACHE_TTL = 30000; // 30 seconds

class Notification {
  // ============================================================
  // SETTINGS CHECK
  // ============================================================

  /**
   * Check if notification system is enabled
   */
  static async isEnabled() {
    const now = Date.now();
    if (_notifEnabledCache !== null && (now - _notifEnabledCacheTime) < NOTIF_CACHE_TTL) {
      return _notifEnabledCache;
    }
    try {
      const [rows] = await db.query(
        `SELECT setting_value FROM admin_settings WHERE setting_key = 'notifications_enabled'`
      );
      _notifEnabledCache = rows.length === 0 || rows[0].setting_value === 'true';
    } catch (e) {
      _notifEnabledCache = true; // default enabled
    }
    _notifEnabledCacheTime = now;
    return _notifEnabledCache;
  }

  /**
   * Reset cache (call after settings update)
   */
  static resetSettingsCache() {
    _notifEnabledCache = null;
    _notifEnabledCacheTime = 0;
  }

  // ============================================================
  // SOCKET.IO HELPERS
  // ============================================================

  /**
   * Get Socket.IO instance from Express app
   */
  static _getIo() {
    try {
      const app = require('../app');
      return app.get('io') || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Emit notification to specific user IDs via Socket.IO
   */
  static async _emitToUsers(userIds, notification, target) {
    const io = this._getIo();
    if (!io) return;
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    for (const uid of ids) {
      try {
        const unreadCount = await this.getUnreadCount(uid, target);
        io.to(`user:${uid}`).emit('notification:new', {
          notification: { ...notification, user_id: uid },
          unreadCount
        });
      } catch (e) { /* ignore emit errors */ }
    }
  }

  // ============================================================
  // CORE CRUD
  // ============================================================

  /**
   * Create a notification for a specific user
   * @param {Object} opts
   * @param {number|null} opts.userId - Target user (null for broadcast)
   * @param {string} opts.target - 'admin' or 'user'
   * @param {string} opts.type - Notification type
   * @param {string} opts.title
   * @param {string} opts.message
   * @param {string|null} opts.link
   * @param {string|null} opts.icon
   * @param {Object|null} opts.metadata
   * @param {number|null} opts.senderId - Admin who initiated
   */
  static async create({ userId, target, type, title, message, link, image_url, icon, metadata, senderId, _skipEnabledCheck }) {
    // Skip if notifications disabled
    if (!_skipEnabledCheck && !(await this.isEnabled())) return { id: null, skipped: true };

    const [result] = await db.query(
      `INSERT INTO notifications (user_id, target, sender_id, type, title, message, link, image_url, icon, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        target || 'user',
        senderId || null,
        type,
        title,
        message,
        link || null,
        image_url || null,
        icon || null,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
    return { id: result.insertId };
  }

  /**
   * Broadcast to all users of a specific role
   * Returns array of created notification IDs (for Socket.IO emission)
   * Also emits Socket.IO events to connected clients in real-time
   */
  static async broadcast({ target, type, title, message, link, image_url, icon, metadata, senderId }) {
    // Skip if notifications disabled
    if (!(await this.isEnabled())) return { count: 0, ids: [], skipped: true };

    const roleFilter = target === 'admin' ? 'admin' : 'user';
    const [users] = await db.query(
      `SELECT id FROM users WHERE role = ? AND deleted_at IS NULL`,
      [roleFilter]
    );

    if (users.length === 0) return { count: 0, ids: [] };

    const values = users.map(u => [
      u.id, target, senderId || null, type, title, message,
      link || null, image_url || null, icon || null,
      metadata ? JSON.stringify(metadata) : null
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flatValues = values.flat();

    const [result] = await db.query(
      `INSERT INTO notifications (user_id, target, sender_id, type, title, message, link, image_url, icon, metadata)
       VALUES ${placeholders}`,
      flatValues
    );

    const startId = result.insertId;
    const endId = startId + result.affectedRows - 1;

    // Emit Socket.IO events to each affected user
    const notificationData = {
      type, title, message, link: link || null,
      image_url: image_url || null, icon: icon || null,
      is_read: 0, created_at: new Date().toISOString()
    };
    this._emitToUsers(users.map(u => u.id), notificationData, target);

    return { count: users.length, ids: users.map(u => u.id), startId, endId };
  }

  /**
   * Send notification to all users (admin push)
   */
  static async sendToAllUsers(data) {
    return this.broadcast({ ...data, target: 'user' });
  }

  /**
   * Send notification to all admins
   */
  static async sendToAllAdmins(data) {
    return this.broadcast({ ...data, target: 'admin' });
  }

  /**
   * Send notification to specific user (with Socket.IO emission)
   */
  static async sendToUser(userId, data) {
    // Skip if notifications disabled
    if (!(await this.isEnabled())) return { id: null, skipped: true };

    const result = await this.create({ ...data, userId, target: 'user', _skipEnabledCheck: true });
    if (result.skipped) return result;
    const notificationData = {
      ...data, id: result.id, user_id: userId,
      is_read: 0, created_at: new Date().toISOString()
    };
    this._emitToUsers(userId, notificationData, 'user');
    return result;
  }

  /**
   * Send notification to specific admin (with Socket.IO emission)
   */
  static async sendToAdmin(userId, data) {
    // Skip if notifications disabled
    if (!(await this.isEnabled())) return { id: null, skipped: true };

    const result = await this.create({ ...data, userId, target: 'admin', _skipEnabledCheck: true });
    if (result.skipped) return result;
    const notificationData = {
      ...data, id: result.id, user_id: userId,
      is_read: 0, created_at: new Date().toISOString()
    };
    this._emitToUsers(userId, notificationData, 'admin');
    return result;
  }

  // ============================================================
  // READ OPERATIONS
  // ============================================================

  /**
   * Get notifications for a user with pagination
   */
  static async listByUser(userId, { page = 1, limit = 20, unreadOnly = false, target } = {}) {
    let where = 'n.user_id = ?';
    const params = [userId];

    if (target) {
      where += ' AND n.target = ?';
      params.push(target);
    }

    if (unreadOnly) {
      where += ' AND n.is_read = 0';
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM notifications n WHERE ${where}`,
      params
    );

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT n.* FROM notifications n
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { notifications: rows, total: countResult[0].total };
  }

  /**
   * Get unread count for a user, optionally filtered by target
   */
  static async getUnreadCount(userId, target) {
    let where = 'user_id = ? AND is_read = 0';
    const params = [userId];

    if (target) {
      where += ' AND target = ?';
      params.push(target);
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) as count FROM notifications WHERE ${where}`,
      params
    );
    return rows[0].count;
  }

  /**
   * Get latest notifications (for Socket.IO initial load / polling fallback)
   */
  static async getLatest(userId, { sinceId = 0, limit = 10, target } = {}) {
    let where = 'n.user_id = ?';
    const params = [userId];

    if (target) {
      where += ' AND n.target = ?';
      params.push(target);
    }

    if (sinceId > 0) {
      where += ' AND n.id > ?';
      params.push(sinceId);
    }

    const [rows] = await db.query(
      `SELECT n.* FROM notifications n
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT ?`,
      [...params, limit]
    );

    return rows;
  }

  /**
   * Mark a single notification as read
   */
  static async markAsRead(notificationId, userId) {
    await db.query(
      `UPDATE notifications SET is_read = 1, read_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );
    return true;
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId, target) {
    let where = 'user_id = ? AND is_read = 0';
    const params = [userId];

    if (target) {
      where += ' AND target = ?';
      params.push(target);
    }

    await db.query(
      `UPDATE notifications SET is_read = 1, read_at = NOW() WHERE ${where}`,
      params
    );
    return true;
  }

  /**
   * Delete a single notification
   */
  static async delete(notificationId, userId) {
    await db.query(
      `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );
    return true;
  }

  /**
   * Delete all notifications for a user
   */
  static async deleteAll(userId, target) {
    let where = 'user_id = ?';
    const params = [userId];

    if (target) {
      where += ' AND target = ?';
      params.push(target);
    }

    await db.query(`DELETE FROM notifications WHERE ${where}`, params);
    return true;
  }

  /**
   * Cleanup old notifications (older than specified days)
   */
  static async cleanupOld(days = 90) {
    const [result] = await db.query(
      `DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );
    return result.affectedRows;
  }

  // ============================================================
  // ADMIN EVENT NOTIFICATIONS
  // ============================================================

  /**
   * Notify admins: new user registration
   */
  static async newUserRegistered(user) {
    return this.broadcast({
      target: 'admin',
      type: 'new_user',
      title: 'New User Registration',
      message: `${user.username} (${user.email}) has registered.`,
      link: `/admin/users/${user.uuid}`,
      icon: 'user-plus',
      metadata: { userId: user.id, uuid: user.uuid, username: user.username }
    });
  }

  /**
   * Notify admins: new transaction pending
   */
  static async transactionPending(transaction, user) {
    return this.broadcast({
      target: 'admin',
      type: 'transaction_pending',
      title: 'New Transaction',
      message: `${user.username} has submitted a transaction for ${transaction.credits_requested} credits.`,
      link: `/admin/transactions/${transaction.id}`,
      icon: 'credit-card',
      metadata: { transactionId: transaction.id, userId: user.id, credits: transaction.credits_requested }
    });
  }

  /**
   * Notify admins: verification request
   */
  static async verificationPending(user) {
    return this.broadcast({
      target: 'admin',
      type: 'verification_pending',
      title: 'New Verification Request',
      message: `${user.username} has requested account verification.`,
      link: `/admin/users/${user.uuid}`,
      icon: 'badge-check',
      metadata: { userId: user.id, uuid: user.uuid, username: user.username }
    });
  }

  /**
   * Notify admins: system alert
   */
  static async systemAlert(title, message, metadata) {
    return this.broadcast({
      target: 'admin',
      type: 'system_alert',
      title,
      message,
      link: '/admin/system-logs',
      icon: 'alert-triangle',
      metadata
    });
  }

  /**
   * Notify admins: payment proof uploaded
   */
  static async paymentProofUploaded(transaction, user) {
    return this.broadcast({
      target: 'admin',
      type: 'payment_proof_uploaded',
      title: 'Payment Proof Uploaded',
      message: `${user.username} has uploaded payment proof for transaction #${transaction.id}.`,
      link: `/admin/transactions/${transaction.id}`,
      icon: 'upload',
      metadata: { transactionId: transaction.id, userId: user.id }
    });
  }

  // ============================================================
  // USER EVENT NOTIFICATIONS
  // ============================================================

  /**
   * Notify user: transaction approved
   */
  static async transactionApproved(transaction) {
    return this.sendToUser(transaction.user_id, {
      type: 'transaction_approved',
      title: 'Transaction Approved',
      message: `Your transaction #${transaction.id} has been approved. Credits have been added to your balance.`,
      link: `/user/transactions/${transaction.id}`,
      icon: 'check-circle',
      metadata: { transactionId: transaction.id, amount: transaction.total_price }
    });
  }

  /**
   * Notify user: transaction rejected
   */
  static async transactionRejected(transaction, reason) {
    return this.sendToUser(transaction.user_id, {
      type: 'transaction_rejected',
      title: 'Transaction Rejected',
      message: `Your transaction #${transaction.id} has been rejected.${reason ? ' Reason: ' + reason : ''}`,
      link: `/user/transactions/${transaction.id}`,
      icon: 'x-circle',
      metadata: { transactionId: transaction.id, reason }
    });
  }

  /**
   * Notify user: credit changed
   */
  static async creditChanged(userId, { amount, type, description }) {
    const isAdd = amount > 0;
    return this.sendToUser(userId, {
      type: `credit_${isAdd ? 'add' : 'deduct'}`,
      title: isAdd ? 'Credits Added' : 'Credits Deducted',
      message: `${Math.abs(amount)} credits ${isAdd ? 'added to' : 'deducted from'} your balance.${description ? ' ' + description : ''}`,
      link: '/user/credits',
      icon: isAdd ? 'plus-circle' : 'minus-circle',
      metadata: { amount, type, description }
    });
  }

  /**
   * Notify user: verification status change
   */
  static async verificationStatus(userId, { status, adminNote }) {
    return this.sendToUser(userId, {
      type: `verification_${status}`,
      title: status === 'approved' ? 'Verification Approved' : 'Verification Rejected',
      message: status === 'approved'
        ? 'Your account has been verified. You now have a verified badge!'
        : `Your verification request has been rejected.${adminNote ? ' Note: ' + adminNote : ''}`,
      link: '/user/profile',
      icon: status === 'approved' ? 'shield-check' : 'shield-x',
      metadata: { status, adminNote }
    });
  }

  /**
   * Notify user: profile updated by admin
   */
  static async profileUpdated(userId, { adminNote }) {
    return this.sendToUser(userId, {
      type: 'profile_updated',
      title: 'Profile Updated',
      message: `Your profile has been updated by an administrator.${adminNote ? ' Note: ' + adminNote : ''}`,
      link: '/user/profile',
      icon: 'user-check',
      metadata: { adminNote }
    });
  }

  /**
   * Notify user: API key limit warning
   */
  static async apiKeyLimitWarning(userId) {
    return this.sendToUser(userId, {
      type: 'api_key_limit_warning',
      title: 'API Key Limit Reached',
      message: 'You have reached the maximum number of API keys. Delete unused keys to create new ones.',
      link: '/user/api-keys',
      icon: 'key',
      metadata: {}
    });
  }

  /**
   * Notify user: package changed by admin
   */
  static async packageChanged(userId, { packageName, credits }) {
    return this.sendToUser(userId, {
      type: 'package_changed',
      title: 'Package Updated',
      message: `Your package has been changed to "${packageName}".${credits ? ` You received ${credits} bonus credits.` : ''}`,
      link: '/user/credits',
      icon: 'package',
      metadata: { packageName, credits }
    });
  }

  /**
   * Notify user: admin push notification
   */
  static async adminPush(userId, { title, message, link, image_url, senderName }) {
    return this.sendToUser(userId, {
      type: 'admin_push',
      title: title || 'Message from Admin',
      message,
      link: link || '/user/dashboard',
      image_url: image_url || null,
      icon: 'megaphone',
      metadata: { senderName }
    });
  }

  // ============================================================
  // WARNING / ALERT NOTIFICATIONS
  // ============================================================

  /**
   * Notify user: low credit warning
   */
  static async lowCreditWarning(userId, { currentCredits, threshold }) {
    return this.sendToUser(userId, {
      type: 'low_credit_warning',
      title: 'Low Credit Balance',
      message: `Your credit balance is running low (${currentCredits} credits remaining). Consider topping up to avoid service interruption.`,
      link: '/user/credits',
      icon: 'trending-down',
      metadata: { currentCredits, threshold }
    });
  }

  /**
   * Notify user: credit exhausted
   */
  static async creditExhausted(userId) {
    return this.sendToUser(userId, {
      type: 'credit_exhausted',
      title: 'Credits Exhausted',
      message: 'Your credit balance has reached zero. All API requests will be blocked until you add more credits.',
      link: '/user/credits',
      icon: 'alert-triangle',
      metadata: {}
    });
  }

  /**
   * Notify user: bonus credit received
   */
  static async creditBonusReceived(userId, { tier, amount, nextBonusAt }) {
    const tierLabel = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' }[tier] || tier;
    let message = `Congratulations! You have received a ${tierLabel} bonus of ${amount} credits.`;
    if (nextBonusAt) {
      const dateStr = new Date(nextBonusAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = new Date(nextBonusAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      message += `The next bonus is available.: ${dateStr} ${timeStr}.`;
    }
    return this.sendToUser(userId, {
      type: 'credit_bonus_received',
      title: `Bonus ${tierLabel} Received!`,
      message,
      link: '/user/credits',
      icon: 'gift',
      metadata: { tier, amount, nextBonusAt: nextBonusAt || null }
    });
  }

  /**
   * Notify admins: a user received bonus credit
   */
  static async userReceivedBonus(userId, { tier, amount }) {
    const tierLabel = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' }[tier] || tier;
    const [userRows] = await db.query('SELECT username, email FROM users WHERE id = ?', [userId]);
    const user = userRows[0];
    return this.sendToAllAdmins({
      type: 'user_bonus_granted',
      title: `Bonus ${tierLabel} Given!`,
      message: `User ${user?.username || userId} received a ${tierLabel} bonus of ${amount} credits.`,
      link: '/admin/credit-logs',
      icon: 'gift',
      metadata: { userId, username: user?.username, tier, amount }
    });
  }

  /**
   * Notify user: package expiring soon
   */
  static async packageExpiring(userId, { packageName, expiresAt }) {
    const expiryDate = new Date(expiresAt);
    const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
    return this.sendToUser(userId, {
      type: 'package_expiring',
      title: 'Package Expiring Soon',
      message: `Your "${packageName}" package will expire in ${daysLeft} day${daysLeft > 1 ? 's' : ''} (${expiryDate.toLocaleDateString('id-ID')}). Renew now to keep your benefits.`,
      link: '/user/packages',
      icon: 'clock',
      metadata: { packageName, expiresAt, daysLeft }
    });
  }

  /**
   * Notify user: package expired
   */
  static async packageExpired(userId, { packageName }) {
    return this.sendToUser(userId, {
      type: 'package_expired',
      title: 'Package Expired',
      message: `Your "${packageName}" package has expired. Your benefits have been reverted to the free tier.`,
      link: '/user/packages',
      icon: 'x-circle',
      metadata: { packageName }
    });
  }

  /**
   * Notify user: new login from unknown device
   */
  static async newLogin(userId, { ip, userAgent, location }) {
    const locationStr = location ? ` from ${location}` : '';
    return this.sendToUser(userId, {
      type: 'new_login',
      title: 'New Login Detected',
      message: `A new login to your account was detected${locationStr} from IP ${ip}. If this wasn't you, please secure your account immediately.`,
      link: '/user/settings',
      icon: 'login',
      metadata: { ip, userAgent, location }
    });
  }

  /**
   * Notify admins: system maintenance scheduled
   */
  static async systemMaintenance({ title, message, scheduledAt }) {
    return this.broadcast({
      target: 'admin',
      type: 'system_maintenance',
      title: title || 'System Maintenance Scheduled',
      message,
      link: '/admin/system-logs',
      icon: 'server',
      metadata: { scheduledAt }
    });
  }

  /**
   * Notify user: API rate limit warning
   */
  static async apiRateLimitWarning(userId, { endpoint, limit }) {
    return this.sendToUser(userId, {
      type: 'system_alert',
      title: 'API Rate Limit Warning',
      message: `You are approaching the rate limit for "${endpoint}" (${limit} requests/hour). Slow down to avoid temporary blocks.`,
      link: '/user/api-logs',
      icon: 'alert-triangle',
      metadata: { endpoint, limit }
    });
  }

  /**
   * Notify admins: user reported an issue
   */
  static async userReportedIssue(user, { subject, description }) {
    return this.broadcast({
      target: 'admin',
      type: 'system_alert',
      title: 'User Issue Report',
      message: `${user.username} reported an issue: "${subject}".`,
      link: '/admin/system-logs',
      icon: 'alert-triangle',
      metadata: { userId: user.id, username: user.username, subject, description }
    });
  }

  // ============================================================
  // TICKET EVENT NOTIFICATIONS
  // ============================================================

  /**
   * Notify admins: new support ticket created
   */
  static async ticketCreated(ticket, user) {
    return this.broadcast({
      target: 'admin',
      type: 'ticket_created',
      title: 'New Support Ticket',
      message: `${user.username} submitted ticket ${ticket.ticket_number}: "${ticket.subject}"`,
      link: `/admin/tickets/${ticket.id}`,
      icon: 'headphones',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticket_number, userId: user.id, username: user.username, subject: ticket.subject, category: ticket.category, priority: ticket.priority }
    });
  }

  /**
   * Notify user: ticket replied (by admin or system)
   */
  static async ticketRepliedToUser(ticket, sender) {
    return this.sendToUser(ticket.user_id, {
      type: 'ticket_replied',
      title: 'Ticket Reply',
      message: `${sender.full_name || sender.username} replied to your ticket ${ticket.ticket_number}.`,
      link: `/user/tickets/${ticket.id}`,
      icon: 'message-circle',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticket_number, senderId: sender.id, senderName: sender.full_name || sender.username }
    });
  }

  /**
   * Notify admins: ticket replied (by user)
   */
  static async ticketRepliedToAdmins(ticket, sender) {
    return this.broadcast({
      target: 'admin',
      type: 'ticket_replied',
      title: 'Ticket Reply',
      message: `${sender.full_name || sender.username} replied to ticket ${ticket.ticket_number}.`,
      link: `/admin/tickets/${ticket.id}`,
      icon: 'message-circle',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticket_number, senderId: sender.id, senderName: sender.full_name || sender.username }
    });
  }

  /**
   * Notify user: ticket status changed
   */
  static async ticketStatusChanged(ticket, oldStatus, newStatus) {
    const statusLabel = { open: 'Open', in_progress: 'In Progress', waiting_reply: 'Waiting Reply', resolved: 'Resolved', closed: 'Closed' };
    return this.sendToUser(ticket.user_id, {
      type: 'ticket_status_changed',
      title: 'Ticket Status Updated',
      message: `Your ticket ${ticket.ticket_number} status changed from "${statusLabel[oldStatus] || oldStatus}" to "${statusLabel[newStatus] || newStatus}".`,
      link: `/user/tickets/${ticket.id}`,
      icon: 'refresh-cw',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticket_number, oldStatus, newStatus }
    });
  }

  /**
   * Notify user: ticket closed
   */
  static async ticketClosed(ticket) {
    return this.sendToUser(ticket.user_id, {
      type: 'ticket_closed',
      title: 'Ticket Closed',
      message: `Your ticket ${ticket.ticket_number} has been closed.`,
      link: `/user/tickets/${ticket.id}`,
      icon: 'check-circle',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticket_number }
    });
  }

  // ============================================================
  // ADMIN PUSH NOTIFICATION (manual)
  // ============================================================

  /**
   * Admin sends push notification to users
   * @param {Object} opts
   * @param {number} opts.adminId - Admin sender ID
   * @param {string} opts.recipient - 'all' or user UUID
   * @param {string} opts.title
   * @param {string} opts.message
   * @param {string|null} opts.link
   */
  static async pushNotification({ adminId, recipient, title, message, link, image_url }) {
    const admin = await db.query(`SELECT full_name FROM users WHERE id = ?`, [adminId]);
    const senderName = admin[0]?.[0]?.full_name || 'Admin';

    if (recipient === 'all') {
      return this.sendToAllUsers({
        type: 'admin_push',
        title: title || 'Message from Admin',
        message,
        link: link || null,
        image_url: image_url || null,
        icon: 'megaphone',
        senderId: adminId,
        metadata: { senderName }
      });
    }

    // Send to specific user by UUID
    const [users] = await db.query(`SELECT id, username FROM users WHERE uuid = ? AND deleted_at IS NULL`, [recipient]);
    if (users.length === 0) return { success: false, message: 'User not found' };

    const user = users[0];
    await this.sendToUser(user.id, {
      type: 'admin_push',
      title: title || 'Message from Admin',
      message,
      link: link || null,
      image_url: image_url || null,
      icon: 'megaphone',
      senderId: adminId,
      metadata: { senderName }
    });

    return { success: true, count: 1, userIds: [user.id] };
  }

  // ============================================================
  // STATS
  // ============================================================

  /**
   * Get notification stats for admin dashboard
   */
  static async getStats() {
    const [total] = await db.query('SELECT COUNT(*) as c FROM notifications');
    const [unread] = await db.query('SELECT COUNT(*) as c FROM notifications WHERE is_read = 0');
    const [todayCount] = await db.query('SELECT COUNT(*) as c FROM notifications WHERE DATE(created_at) = CURDATE()');
    const [typeCount] = await db.query(
      'SELECT target, COUNT(*) as c FROM notifications WHERE is_read = 0 GROUP BY target'
    );

    const byTarget = {};
    typeCount.forEach(r => { byTarget[r.target] = r.c; });

    return {
      total: total[0].c,
      unread: unread[0].c,
      today: todayCount[0].c,
      unreadAdmin: byTarget.admin || 0,
      unreadUser: byTarget.user || 0
    };
  }
}

module.exports = Notification;
