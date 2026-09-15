const db = require('../config/database');
const crypto = require('crypto');

class PlaygroundSession {
  /**
   * Find any session for a user (active or expired)
   */
  static async findAnyForUser(userId) {
    const [rows] = await db.query(
      `SELECT * FROM playground_sessions
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create or renew a playground session (1 user = 1 session)
   * If session exists (active or expired), UPDATE it. Otherwise INSERT.
   */
  static async create(userId, ip) {
    const token = crypto.randomBytes(32).toString('hex');
    const fingerprint = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 1000);

    const existing = await this.findAnyForUser(userId);

    if (existing) {
      // UPDATE existing row — no new ID, no gap
      await db.query(
        `UPDATE playground_sessions
         SET token = ?, fingerprint = ?, ip_address = ?,
             request_count = 0, honeypot_hits = 0,
             last_request_at = NULL, is_active = 1,
             created_at = NOW(), expires_at = ?,
             captcha_answer = NULL, captcha_token = NULL, captcha_expires = NULL
         WHERE id = ?`,
        [token, fingerprint, ip, expiresAt, existing.id]
      );
      return { id: existing.id, token, fingerprint, expiresAt };
    }

    // First time — INSERT new row
    const [result] = await db.query(
      `INSERT INTO playground_sessions (user_id, token, fingerprint, ip_address, request_count, created_at, expires_at)
       VALUES (?, ?, ?, ?, 0, NOW(), ?)`,
      [userId, token, fingerprint, ip, expiresAt]
    );

    return { id: result.insertId, token, fingerprint, expiresAt };
  }

  /**
   * Store CAPTCHA answer in session
   */
  static async setCaptchaChallenge(sessionId, answer) {
    const token = crypto.randomBytes(16).toString('hex');
    await db.query(
      `UPDATE playground_sessions SET captcha_answer = ?, captcha_token = ?, captcha_expires = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id = ?`,
      [answer, token, sessionId]
    );
    return token;
  }

  /**
   * Verify CAPTCHA answer
   */
  static async verifyCaptcha(sessionId, captchaToken, answer) {
    const [rows] = await db.query(
      `SELECT captcha_answer, captcha_token, captcha_expires FROM playground_sessions WHERE id = ?`,
      [sessionId]
    );
    if (rows.length === 0) return false;
    const row = rows[0];
    if (!row.captcha_token || !row.captcha_answer) return false;
    if (row.captcha_token !== captchaToken) return false;
    if (new Date(row.captcha_expires) < new Date()) return false;
    if (parseInt(answer) !== parseInt(row.captcha_answer)) return false;
    // Clear captcha after success
    await db.query(
      `UPDATE playground_sessions SET captcha_answer = NULL, captcha_token = NULL, captcha_expires = NULL WHERE id = ?`,
      [sessionId]
    );
    return true;
  }

  /**
   * Find active (non-expired) session for a user
   */
  static async findActiveForUser(userId) {
    const [rows] = await db.query(
      `SELECT * FROM playground_sessions
       WHERE user_id = ? AND expires_at > NOW() AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Validate a playground session
   */
  static async validate(token, fingerprint, ip) {
    const [rows] = await db.query(
      `SELECT * FROM playground_sessions
       WHERE token = ? AND fingerprint = ? AND expires_at > NOW() AND is_active = 1`,
      [token, fingerprint]
    );

    if (rows.length === 0) return null;

    const session = rows[0];

    // Check IP match (prevent token theft)
    if (session.ip_address !== ip) {
      await this.deactivate(session.id);
      return null;
    }

    return session;
  }

  /**
   * Check rate limit without incrementing (20 req per session)
   * Rate limit ties to session lifetime — resets when session expires (new session = fresh 20)
   */
  static async checkRateLimit(sessionId) {
    const [rows] = await db.query(
      `SELECT request_count, expires_at
       FROM playground_sessions WHERE id = ? AND is_active = 1`,
      [sessionId]
    );

    if (rows.length === 0) return { allowed: false, reason: 'Session not found', remaining: 0, resetIn: 0 };

    const session = rows[0];
    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    const resetIn = Math.max(0, Math.ceil((expiresAt - now) / 1000));

    // Session expired — shouldn't normally reach here (validate catches it), but handle it
    if (now >= expiresAt) {
      return { allowed: false, remaining: 0, resetIn: 0 };
    }

    // Within session lifetime — check request count
    if (session.request_count >= 20) {
      return { allowed: false, remaining: 0, resetIn };
    }

    return { allowed: true, remaining: 20 - session.request_count, resetIn };
  }

  /**
   * Increment rate limit counter (call only on successful requests)
   */
  static async incrementRateLimit(sessionId) {
    await db.query(
      `UPDATE playground_sessions SET request_count = request_count + 1 WHERE id = ?`,
      [sessionId]
    );
  }

  /**
   * Record a honeypot hit
   */
  static async recordHoneypot(sessionId) {
    await db.query(
      `UPDATE playground_sessions SET honeypot_hits = honeypot_hits + 1 WHERE id = ?`,
      [sessionId]
    );

    // If 2+ honeypot hits, deactivate and flag user
    const [rows] = await db.query(
      `SELECT honeypot_hits, user_id FROM playground_sessions WHERE id = ?`,
      [sessionId]
    );

    if (rows.length > 0 && rows[0].honeypot_hits >= 2) {
      await this.deactivate(sessionId);
      await db.query(
        `UPDATE users SET is_active = 0 WHERE id = ?`,
        [rows[0].user_id]
      );
      return true; // User was banned
    }
    return false;
  }

  /**
   * Deactivate a session
   */
  static async deactivate(sessionId) {
    await db.query(
      `UPDATE playground_sessions SET is_active = 0 WHERE id = ?`,
      [sessionId]
    );
  }

  /**
   * Cleanup expired sessions (run periodically)
   */
  static async cleanup() {
    await db.query(
      `DELETE FROM playground_sessions WHERE expires_at < NOW() OR is_active = 0`
    );

    // If table is empty, reset AUTO_INCREMENT to 1
    const [count] = await db.query(`SELECT COUNT(*) as cnt FROM playground_sessions`);
    if (count[0].cnt === 0) {
      await db.query(`ALTER TABLE playground_sessions AUTO_INCREMENT = 1`);
    }
  }

  /**
   * Get user's playground stats (for monitoring)
   */
  static async getUserStats(userId) {
    const [rows] = await db.query(
      `SELECT COUNT(*) as total_sessions,
              SUM(request_count) as total_requests,
              SUM(honeypot_hits) as honeypot_hits
       FROM playground_sessions WHERE user_id = ?`,
      [userId]
    );
    return rows[0] || { total_sessions: 0, total_requests: 0, honeypot_hits: 0 };
  }
}

module.exports = PlaygroundSession;
