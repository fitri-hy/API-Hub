const db = require('../config/database');

class AdminSettings {
  static async get(key) {
    const [rows] = await db.query('SELECT * FROM admin_settings WHERE setting_key = ?', [key]);
    if (!rows.length) return null;
    const row = rows[0];
    switch (row.setting_type) {
      case 'int': return parseInt(row.setting_value);
      case 'bool': return row.setting_value === 'true' || row.setting_value === '1';
      case 'json': return JSON.parse(row.setting_value);
      default: return row.setting_value;
    }
  }

  static async getAll() {
    const [rows] = await db.query('SELECT * FROM admin_settings ORDER BY id');
    return rows.map(r => ({
      ...r,
      parsed: (() => {
        switch (r.setting_type) {
          case 'int': return parseInt(r.setting_value);
          case 'bool': return r.setting_value === 'true' || r.setting_value === '1';
          case 'json': try { return JSON.parse(r.setting_value); } catch { return r.setting_value; }
          default: return r.setting_value;
        }
      })()
    }));
  }

  static async set(key, value) {
    await db.query(
      `INSERT INTO admin_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, String(value)]
    );
  }

  static async setMany(settings) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, value] of Object.entries(settings)) {
        await conn.query(
          `INSERT INTO admin_settings (setting_key, setting_value)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, String(value)]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = AdminSettings;