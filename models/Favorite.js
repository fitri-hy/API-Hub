const db = require('../config/database');

class Favorite {
  // ── Toggle favorite on/off, returns new state ──
  static async toggle(userId, apiId) {
    const existing = await this.find(userId, apiId);
    if (existing) {
      await db.query('DELETE FROM user_favorites WHERE id = ?', [existing.id]);
      return false; // removed
    }
    await db.query(
      'INSERT INTO user_favorites (user_id, api_id) VALUES (?, ?)',
      [userId, apiId]
    );
    return true; // added
  }

  // ── Check if a single API is favorited by user ──
  static async find(userId, apiId) {
    const [rows] = await db.query(
      'SELECT * FROM user_favorites WHERE user_id = ? AND api_id = ?',
      [userId, apiId]
    );
    return rows[0] || null;
  }

  // ── Get all favorite API ids for a user (fast lookup) ──
  static async getIds(userId) {
    const [rows] = await db.query(
      'SELECT api_id FROM user_favorites WHERE user_id = ?',
      [userId]
    );
    return rows.map(r => r.api_id);
  }
}

module.exports = Favorite;
