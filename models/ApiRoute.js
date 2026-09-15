const db = require('../config/database');

class ApiRoute {
  // Find by ID
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT ar.*, a.name as api_name, a.slug as api_slug
       FROM api_routes ar
       LEFT JOIN apis a ON ar.api_id = a.id
       WHERE ar.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Find by API ID
  static async findByApiId(apiId) {
    const [rows] = await db.query(
      `SELECT * FROM api_routes WHERE api_id = ? ORDER BY method, path`,
      [apiId]
    );
    return rows;
  }

  // Find active routes for an API
  static async findActiveByApiId(apiId) {
    const [rows] = await db.query(
      'SELECT * FROM api_routes WHERE api_id = ? AND is_active = 1 ORDER BY method, path',
      [apiId]
    );
    return rows;
  }

  // Find route by API slug, method and path
  static async findByEndpoint(apiSlug, method, path) {
    const [rows] = await db.query(
      `SELECT ar.*, a.id as api_id, a.credit_cost, a.auth_required,
              a.slug as api_slug, a.status as api_status
       FROM api_routes ar
       JOIN apis a ON ar.api_id = a.id
       WHERE a.slug = ? AND ar.method = ? AND ar.path = ? AND ar.is_active = 1 AND a.status = 'active' AND a.deleted_at IS NULL`,
      [apiSlug, method.toUpperCase(), path]
    );
    return rows[0] || null;
  }

  // Create route
  static async create(data) {
    const [result] = await db.query(
      `INSERT INTO api_routes (api_id, method, path, handler_code, description, documentation, request_schema, response_schema, sample_response, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.apiId, data.method, data.path, data.handlerCode,
       data.description || '', data.documentation || '',
       data.requestSchema ? JSON.stringify(data.requestSchema) : null,
       data.responseSchema ? JSON.stringify(data.responseSchema) : null,
       data.sampleResponse ? JSON.stringify(data.sampleResponse) : null,
       data.isActive !== false ? 1 : 0]
    );
    return this.findById(result.insertId);
  }

  // Update route
  static async update(id, data) {
    const fields = [];
    const values = [];

    const allowedFields = ['method', 'path', 'handler_code', 'description', 'documentation', 'request_schema', 'response_schema', 'sample_response', 'is_active'];

    for (const field of allowedFields) {
      const camelField = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (data[camelField] !== undefined) {
        fields.push(`${field} = ?`);
        const val = data[camelField];
        if (['request_schema', 'response_schema', 'sample_response'].includes(field) && typeof val === 'object') {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await db.query(`UPDATE api_routes SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  // Delete route
  static async delete(id) {
    await db.query('DELETE FROM request_logs WHERE route_id = ?', [id]);
    await db.query('DELETE FROM api_routes WHERE id = ?', [id]);
  }

  // List routes for API with pagination
  static async list({ apiId, page = 1, limit = 50 }) {
    const offset = (page - 1) * limit;

    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM api_routes WHERE api_id = ?', [apiId]
    );

    const [rows] = await db.query(
      'SELECT * FROM api_routes WHERE api_id = ? ORDER BY method, path LIMIT ? OFFSET ?',
      [apiId, limit, offset]
    );

    return { routes: rows, total: countResult[0].total };
  }
}

module.exports = ApiRoute;
