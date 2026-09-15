const db = require('../config/database');

class Package {
  static async findById(id) {
    const [rows] = await db.query('SELECT * FROM packages WHERE id = ?', [id]);
    return rows[0] || null;
  }

  static async findBySlug(slug) {
    const [rows] = await db.query('SELECT * FROM packages WHERE slug = ? AND is_active = 1', [slug]);
    return rows[0] || null;
  }

  static async findAll() {
    const [rows] = await db.query('SELECT * FROM packages ORDER BY sort_order ASC, price ASC');
    return rows;
  }

  static async findActive() {
    const [rows] = await db.query('SELECT * FROM packages WHERE is_active = 1 ORDER BY sort_order ASC, price ASC');
    return rows;
  }

  static async create(data) {
    const [result] = await db.query(
      `INSERT INTO packages (slug, name, description, price, credits_included, rate_limit_per_minute, features, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.slug, data.name, data.description || '', data.price || 0,
       data.creditsIncluded || 0, data.rateLimitPerMinute || 100,
       data.features ? JSON.stringify(data.features) : null,
       data.isActive !== false ? 1 : 0, data.sortOrder || 0]
    );
    return this.findById(result.insertId);
  }

  static async update(id, data) {
	  const fields = [];
	  const values = [];

	  const allowedFields = [
		'slug',
		'name',
		'description',
		'price',
		'credits_included',
		'rate_limit_per_minute',
		'features',
		'is_active',
		'sort_order'
	  ];

	  for (const field of allowedFields) {
		const camelField = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

		if (data[camelField] !== undefined) {
		  fields.push(`${field} = ?`);

		  if (field === 'features') {
			// Kosong/null => SQL NULL
			if (
			  data[camelField] === null ||
			  data[camelField] === '' ||
			  (Array.isArray(data[camelField]) && data[camelField].length === 0)
			) {
			  values.push(null);
			} else {
			  values.push(JSON.stringify(data[camelField]));
			}
		  } else {
			values.push(data[camelField]);
		  }
		}
	  }

	  if (fields.length === 0) return this.findById(id);

	  values.push(id);

	  await db.query(
		`UPDATE packages SET ${fields.join(', ')} WHERE id = ?`,
		values
	  );

	  return this.findById(id);
  }

  static async delete(id) {
    await db.query('DELETE FROM packages WHERE id = ?', [id]);
  }

  static async count() {
    const [rows] = await db.query('SELECT COUNT(*) as total FROM packages');
    return rows[0].total;
  }
}

module.exports = Package;
