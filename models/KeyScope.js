const db = require('../config/database');

class KeyScope {
  // Get all scopes for an API key
  static async listByKey(apiKeyId) {
    const [rows] = await db.query(
      `SELECT ks.*, a.name as api_name, a.slug as api_slug
       FROM key_scopes ks
       JOIN apis a ON a.id = ks.api_id AND a.deleted_at IS NULL
       WHERE ks.api_key_id = ?
       ORDER BY a.name ASC`,
      [apiKeyId]
    );
    return rows;
  }

  // Check if an API key has scope for a specific API + method
  static async hasScope(apiKeyId, apiId, method) {
    const [rows] = await db.query(
      `SELECT id FROM key_scopes
       WHERE api_key_id = ? AND api_id = ? AND FIND_IN_SET(?, allowed_methods) > 0`,
      [apiKeyId, apiId, method]
    );
    return rows.length > 0;
  }

  // Check if API key has any scopes (empty = full access)
  static async hasAnyScope(apiKeyId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) as total FROM key_scopes WHERE api_key_id = ?',
      [apiKeyId]
    );
    return rows[0].total > 0;
  }

  // Set scopes for an API key (replaces all existing)
  static async setScopes(apiKeyId, scopes) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [delResult] = await conn.query('DELETE FROM key_scopes WHERE api_key_id = ?', [apiKeyId]);

      if (scopes && scopes.length > 0) {
        for (const scope of scopes) {
          const methods = Array.isArray(scope.methods) ? scope.methods.join(',') : scope.methods;
          await conn.query(
            'INSERT INTO key_scopes (api_key_id, api_id, allowed_methods) VALUES (?, ?, ?)',
            [apiKeyId, scope.apiId, methods]
          );
        }
      } else {
        // Blank
      }

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Add a single scope
  static async addScope(apiKeyId, apiId, methods) {
    const methodStr = Array.isArray(methods) ? methods.join(',') : methods;
    await db.query(
      `INSERT INTO key_scopes (api_key_id, api_id, allowed_methods)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE allowed_methods = VALUES(allowed_methods)`,
      [apiKeyId, apiId, methodStr]
    );
    return true;
  }

  // Remove a scope
  static async removeScope(apiKeyId, apiId) {
    await db.query(
      'DELETE FROM key_scopes WHERE api_key_id = ? AND api_id = ?',
      [apiKeyId, apiId]
    );
    return true;
  }

  // Get scope count for a key
  static async countByKey(apiKeyId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) as total FROM key_scopes WHERE api_key_id = ?',
      [apiKeyId]
    );
    return rows[0].total;
  }
}

module.exports = KeyScope;
