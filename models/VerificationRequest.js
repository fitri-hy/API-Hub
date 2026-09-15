const db = require('../config/database');

class VerificationRequest {
  /**
   * Create a new verification request from a user
   */
  static async create(userId, reason = null) {
    // Check if user already has a pending request
    const [existing] = await db.query(
      `SELECT id FROM verification_requests 
       WHERE user_id = ? AND status = 'pending' LIMIT 1`,
      [userId]
    );
    if (existing.length > 0) {
      return { success: false, message: 'You already have a pending verification request.' };
    }

    // Check if user is already verified
    const [user] = await db.query('SELECT is_verified FROM users WHERE id = ?', [userId]);
    if (user.length > 0 && user[0].is_verified) {
      return { success: false, message: 'Your account is already verified.' };
    }

    const [result] = await db.query(
      'INSERT INTO verification_requests (user_id, reason) VALUES (?, ?)',
      [userId, reason || null]
    );
    return { success: true, id: result.insertId };
  }

  /**
   * Get pending request for a user
   */
  static async getPendingByUser(userId) {
    const [rows] = await db.query(
      `SELECT * FROM verification_requests 
       WHERE user_id = ? AND status = 'pending' 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  }

  /**
   * Get latest request (any status) for a user
   */
  static async getLatestByUser(userId) {
    const [rows] = await db.query(
      `SELECT * FROM verification_requests 
       WHERE user_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  }

  /**
   * Approve a verification request
   */
  static async approve(requestId, adminId, adminNote = null) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        'SELECT * FROM verification_requests WHERE id = ? AND status = ? FOR UPDATE',
        [requestId, 'pending']
      );
      if (rows.length === 0) {
        await conn.rollback();
        return { success: false, message: 'Request not found or already processed.' };
      }

      const request = rows[0];

      // Update request status
      await conn.query(
        `UPDATE verification_requests 
         SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = NOW() 
         WHERE id = ?`,
        [adminNote, adminId, requestId]
      );

      // Set user as verified
      await conn.query(
        'UPDATE users SET is_verified = 1 WHERE id = ?',
        [request.user_id]
      );

      await conn.commit();
      return { success: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Reject a verification request
   */
  static async reject(requestId, adminId, adminNote = null) {
    const [rows] = await db.query(
      'SELECT * FROM verification_requests WHERE id = ? AND status = ?',
      [requestId, 'pending']
    );
    if (rows.length === 0) {
      return { success: false, message: 'Request not found or already processed.' };
    }

    await db.query(
      `UPDATE verification_requests 
       SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW() 
       WHERE id = ?`,
      [adminNote, adminId, requestId]
    );

    return { success: true };
  }

  /**
   * List all verification requests (admin view) with user info
   */
  static async listAll({ page = 1, limit = 20, status = '' } = {}) {
    let where = '1=1';
    const params = [];

    if (status) {
      where += ' AND vr.status = ?';
      params.push(status);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM verification_requests vr WHERE ${where}`,
      params
    );
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT vr.*, 
              u.username, u.email, u.full_name, u.avatar, u.uuid,
              reviewer.username as reviewer_name
       FROM verification_requests vr
       LEFT JOIN users u ON vr.user_id = u.id
       LEFT JOIN users reviewer ON vr.reviewed_by = reviewer.id
       WHERE ${where}
       ORDER BY vr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { requests: rows, total };
  }

  /**
   * Get user IDs that have pending verification requests
   */
  static async getPendingUserIds() {
    const [rows] = await db.query(
      `SELECT DISTINCT user_id FROM verification_requests WHERE status = 'pending'`
    );
    return rows.map(r => r.user_id);
  }

  /**
   * Get verification requests by status count
   */
  static async countByStatus() {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) as count FROM verification_requests GROUP BY status`
    );
    const counts = { pending: 0, approved: 0, rejected: 0 };
    rows.forEach(r => { counts[r.status] = r.count; });
    return counts;
  }
}

module.exports = VerificationRequest;
