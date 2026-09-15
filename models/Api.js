const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const helpers = require('../utils/helpers');

class Api {
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT * FROM apis WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    return rows[0] || null;
  }

  static async findBySlug(slug) {
    const [rows] = await db.query(
      `SELECT * FROM apis WHERE slug = ? AND deleted_at IS NULL`, [slug]
    );
    return rows[0] || null;
  }

  static async create(data) {
    const uuid = uuidv4();
    const slug = data.slug || helpers.slugify(data.name);
    const baseRoute = `/gateway/${slug}`;

    const [result] = await db.query(
      `INSERT INTO apis (uuid, name, slug, description, version, status, credit_cost,
                         rate_limit_per_minute, documentation, base_route, auth_required, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, data.name, slug, data.description || '',
       data.version || '1.0.0', data.status || 'draft', data.creditCost || 1,
       data.rateLimitPerMinute || 500, data.documentation || '',
       baseRoute, data.authRequired !== false ? 1 : 0, data.isPublic !== false ? 1 : 0]
    );

    return this.findById(result.insertId);
  }

  static async update(id, data) {
    const fields = [];
    const values = [];

    const allowed = ['name', 'description', 'version', 'status', 'credit_cost',
      'rate_limit_per_minute', 'documentation', 'auth_required', 'is_public'];

    // Build lookup: also check camelCase versions of snake_case allowed fields
    const camelLookup = {};
    for (const field of allowed) {
      const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      camelLookup[camel] = field;
    }

    for (const field of allowed) {
      let val;
      if (data[field] !== undefined) {
        val = data[field];
      } else if (camelLookup[field] && data[camelLookup[field]] !== undefined) {
        val = data[camelLookup[field]];
      } else {
        // Check if any camelCase key maps to this snake_case field
        for (const [ck, cv] of Object.entries(data)) {
          if (camelLookup[ck] === field) { val = cv; break; }
        }
      }
      if (val !== undefined) {
        fields.push(`${field} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await db.query(`UPDATE apis SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  static async list({ page = 1, limit = 20, status = '', search = '' } = {}) {
    let where = 'a.deleted_at IS NULL';
    const params = [];

    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (a.name LIKE ? OR a.slug LIKE ? OR a.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM apis a WHERE ${where}`, params);
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT a.*,
              (SELECT COUNT(*) FROM api_routes WHERE api_id = a.id AND is_active = 1) as route_count
       FROM apis a
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { apis: rows, total };
  }

  static async count(filters = {}) {
    let where = 'deleted_at IS NULL';
    const params = [];
    if (filters.status) { where += ' AND status = ?'; params.push(filters.status); }
    const [rows] = await db.query(`SELECT COUNT(*) as total FROM apis WHERE ${where}`, params);
    return rows[0].total;
  }

  static async incrementRequest(id, success = true) {
    const field = success ? 'successful_requests' : 'failed_requests';
    await db.query(
      `UPDATE apis SET total_requests = total_requests + 1, ${field} = ${field} + 1 WHERE id = ?`, [id]
    );
  }

  static async softDelete(id) {
    await db.query('DELETE FROM request_logs WHERE api_id = ?', [id]);
    await db.query(
      'UPDATE apis SET total_requests = 0, successful_requests = 0, failed_requests = 0, deleted_at = NOW(), status = "inactive" WHERE id = ?',
      [id]
    );
  }
  
  static async findPublic() {
    const [rows] = await db.query(
      `SELECT *
       FROM apis
       WHERE deleted_at IS NULL
         AND status = 'active'
         AND is_public = 1
       ORDER BY name ASC`
    );

    return rows;
  }
  
  static async getPublicStats() {
    const [rows] = await db.query(`
      SELECT
        COUNT(DISTINCT a.id) AS api_count,
        COUNT(ar.id) AS endpoint_count
      FROM apis a
      LEFT JOIN api_routes ar
        ON ar.api_id = a.id
        AND ar.is_active = 1
      WHERE a.deleted_at IS NULL
        AND a.status = 'active'
        AND a.is_public = 1
    `);

    return {
      apiCount: Number(rows[0].api_count || 0),
      endpointCount: Number(rows[0].endpoint_count || 0)
    };
  }
}

module.exports = Api;
