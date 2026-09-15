/**
 * Database Initialization Script — v2
 * Run: npm run db:init
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function initDatabase() {
  console.log('Initializing database (v2)...\n');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true
  });

  const dbName = process.env.DB_NAME || 'saas_gateway';

  await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`Database "${dbName}" created`);
  await conn.query(`USE \`${dbName}\``);

  // ============================================
  // USERS TABLE (no api_key — moved to api_keys)
  // ============================================
  await conn.query(`
    CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uuid CHAR(36) NOT NULL UNIQUE,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(100) NOT NULL DEFAULT '',
      role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
      package_id INT NULL,
      custom_rate_limit INT NULL COMMENT 'Custom rate limit req/min for custom packages',
      avatar VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_verified TINYINT(1) NOT NULL DEFAULT 0,
      last_login DATETIME NULL,
      last_login_ip VARCHAR(45) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      INDEX idx_users_email (email),
      INDEX idx_users_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: users');

  // ============================================
  // PACKAGES TABLE
  // ============================================
  await conn.query(`
    CREATE TABLE packages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(50) NOT NULL,
      description TEXT NULL,
      price INT NOT NULL DEFAULT 0 COMMENT 'Price in IDR',
      credits_included INT NOT NULL DEFAULT 0,
      rate_limit_per_minute INT NOT NULL DEFAULT 100,
      features JSON NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: packages');

  // ============================================
  // CREDITS TABLE
  // ============================================
  await conn.query(`
    CREATE TABLE credits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      balance INT NOT NULL DEFAULT 0,
      total_earned INT NOT NULL DEFAULT 0,
      total_spent INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_credits_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: credits');

  // ============================================
  // CREDIT TRANSACTIONS TABLE
  // ============================================
  await conn.query(`
    CREATE TABLE credit_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      api_key_id INT NULL,
      type ENUM('deduct', 'add', 'purchase', 'bonus', 'refund', 'subscription') NOT NULL,
      amount INT NOT NULL COMMENT 'Positive = add, Negative = deduct',
      balance_after INT NOT NULL,
      reference_type VARCHAR(50) NULL,
      reference_id INT NULL,
      description TEXT NOT NULL,
      admin_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_credit_txn_user (user_id),
      INDEX idx_credit_txn_type (type),
      INDEX idx_credit_txn_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: credit_transactions');

  // ============================================
  // APIS TABLE (admin-owned, no user_id)
  // ============================================
  await conn.query(`
    CREATE TABLE apis (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uuid CHAR(36) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(120) NOT NULL UNIQUE,
      description TEXT NULL,
      version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      status ENUM('active', 'inactive', 'draft') NOT NULL DEFAULT 'draft',
      credit_cost INT NOT NULL DEFAULT 1 COMMENT 'Credits per successful request — set by admin',
      rate_limit_per_minute INT NOT NULL DEFAULT 500,
      documentation TEXT NULL,
      base_route VARCHAR(255) NOT NULL,
      auth_required TINYINT(1) NOT NULL DEFAULT 1,
      is_public TINYINT(1) NOT NULL DEFAULT 1,
      total_requests INT NOT NULL DEFAULT 0,
      successful_requests INT NOT NULL DEFAULT 0,
      failed_requests INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      INDEX idx_apis_slug (slug),
      INDEX idx_apis_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: apis');

  // ============================================
  // API KEYS TABLE (user-owned, per-key credit limit)
  // ============================================
  await conn.query(`
    CREATE TABLE api_keys (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL DEFAULT 'Default',
      key_value VARCHAR(64) NOT NULL UNIQUE,
      credit_limit INT NOT NULL DEFAULT 0 COMMENT '0 = unlimited, uses user balance',
      credits_used INT NOT NULL DEFAULT 0,
      credits_used_total INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_used_at DATETIME NULL,
      last_used_ip VARCHAR(45) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_apikeys_user (user_id),
      INDEX idx_apikeys_key (key_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: api_keys');

  // ============================================
  // API ROUTES TABLE
  // ============================================
  await conn.query(`
    CREATE TABLE api_routes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      api_id INT NOT NULL,
      method ENUM('GET', 'POST', 'PUT', 'DELETE', 'PATCH') NOT NULL DEFAULT 'GET',
      path VARCHAR(255) NOT NULL,
      handler_code LONGTEXT NOT NULL COMMENT 'Node.js handler code — written by admin',
      description TEXT NULL,
      request_schema JSON NULL,
      response_schema JSON NULL,
      sample_response JSON NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (api_id) REFERENCES apis(id) ON DELETE CASCADE,
      INDEX idx_api_routes_api (api_id),
      UNIQUE KEY uk_api_route (api_id, method, path)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: api_routes');

  // ============================================
  // REQUEST LOGS TABLE (with api_key_id)
  // ============================================
  await conn.query(`
    CREATE TABLE request_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      api_id INT NOT NULL,
      route_id INT NULL,
      user_id INT NOT NULL,
      api_key_id INT NULL,
      method VARCHAR(10) NOT NULL,
      path VARCHAR(500) NOT NULL,
      query_params JSON NULL,
      request_body LONGTEXT NULL,
      request_headers JSON NULL,
      response_status INT NOT NULL DEFAULT 200,
      response_body LONGTEXT NULL,
      response_time_ms INT NULL,
      ip_address VARCHAR(45) NULL,
      user_agent TEXT NULL,
      credit_cost INT NOT NULL DEFAULT 0,
      is_success TINYINT(1) NOT NULL DEFAULT 1,
      error_message TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (api_id) REFERENCES apis(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
      INDEX idx_reqlog_api (api_id),
      INDEX idx_reqlog_user (user_id),
      INDEX idx_reqlog_apikey (api_key_id),
      INDEX idx_reqlog_created (created_at),
      INDEX idx_reqlog_status (response_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: request_logs');

  // ============================================
  // RATE LIMITS TABLE (per api_key)
  // ============================================
  await conn.query(`
    CREATE TABLE rate_limits (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      api_key_id INT NOT NULL,
      api_id INT NULL,
      window_start DATETIME NOT NULL,
      request_count INT NOT NULL DEFAULT 1,
      max_requests INT NOT NULL,
      UNIQUE KEY uk_rate_window (api_key_id, api_id, window_start),
      INDEX idx_rate_apikey (api_key_id),
      INDEX idx_rate_cleanup (window_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: rate_limits');

  // ============================================
  // ADMIN SETTINGS TABLE
  // ============================================
  await conn.query(`
    CREATE TABLE admin_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value TEXT NULL,
      setting_type ENUM('string', 'int', 'bool', 'json') NOT NULL DEFAULT 'string',
      description TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: admin_settings');

  // ============================================
  // SYSTEM LOGS TABLE
  // ============================================
  await conn.query(`
    CREATE TABLE system_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(100) NOT NULL,
      details JSON NULL,
      ip_address VARCHAR(45) NULL,
      user_agent TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_syslog_user (user_id),
      INDEX idx_syslog_action (action),
      INDEX idx_syslog_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('Table: system_logs');

  // ============================================
  // SEED DATA
  // ============================================
  console.log('\nSeeding default data...');

  const packages = [
    ['bronze', 'Bronze', 'For developers getting started', 49900, 500, 300],
    ['silver', 'Silver', 'For growing applications', 99900, 2000, 500],
    ['gold', 'Gold', 'For professional use', 199900, 10000, 1000]
  ];

  for (const pkg of packages) {
    await conn.query(
      `INSERT INTO packages (slug, name, description, price, credits_included, rate_limit_per_minute) VALUES (?, ?, ?, ?, ?, ?)`,
      pkg
    );
  }
  console.log('Seeded: packages');

  const settings = [
    ['app_name', 'SaaSGateway', 'string', 'Application name'],
    ['default_credits', '100', 'int', 'Default credits for new users'],
    ['credit_value_rp', '50', 'int', 'Value of 1 credit in IDR'],
    ['global_rate_limit', '500', 'int', 'Default rate limit per minute'],
    ['registration_enabled', 'true', 'bool', 'Allow new registrations'],
    ['maintenance_mode', 'false', 'bool', 'Enable maintenance mode'],
    // Site Identity
    ['site_title', '', 'string', 'Website display title'],
    ['site_description', '', 'string', 'Website short description'],
    ['site_keywords', '', 'string', 'Website keywords (comma-separated)'],
    ['site_logo', '', 'string', 'Website logo image path'],
    ['site_favicon', '', 'string', 'Website favicon image path'],
    // SEO
    ['seo_meta_title', '', 'string', 'HTML meta title for SEO'],
    ['seo_meta_description', '', 'string', 'HTML meta description for SEO'],
    ['seo_meta_keywords', '', 'string', 'HTML meta keywords for SEO'],
    // Open Graph
    ['og_title', '', 'string', 'Open Graph title for social sharing'],
    ['og_description', '', 'string', 'Open Graph description for social sharing'],
    ['og_url', '', 'string', 'Open Graph canonical URL'],
    ['site_og_image', '', 'string', 'Open Graph image path'],
  ];

  for (const s of settings) {
    await conn.query(
      `INSERT INTO admin_settings (setting_key, setting_value, setting_type, description) VALUES (?, ?, ?, ?)`, s
    );
  }
  console.log('Seeded: admin_settings');

  // Create admin
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const crypto = require('crypto');

  const adminUuid = uuidv4();
  const adminHash = await bcrypt.hash('admin123', 12);

  const [adminResult] = await conn.query(`
    INSERT INTO users (uuid, username, email, password_hash, full_name, role, is_active, is_verified)
    VALUES (?, 'admin', 'admin@saasgateway.local', ?, 'System Administrator', 'admin', 1, 1)
  `, [adminUuid, adminHash]);

  const adminId = adminResult.insertId;
  await conn.query('INSERT INTO credits (user_id, balance, total_earned) VALUES (?, 999999999, 999999999)', [adminId]);
  console.log('Created: admin (admin@saasgateway.local / admin123)');

  // Create demo user
  const userUuid = uuidv4();
  const userHash = await bcrypt.hash('user123', 12);
  const [basicPkg] = await conn.query('SELECT id FROM packages WHERE slug = ?', ['basic']);

  const [userResult] = await conn.query(`
    INSERT INTO users (uuid, username, email, password_hash, full_name, role, is_active, is_verified, package_id)
    VALUES (?, 'demo', 'demo@saasgateway.local', ?, 'Demo User', 'user', 1, 1, ?)
  `, [userUuid, userHash, basicPkg[0]?.id || null]);

  const userId = userResult.insertId;
  await conn.query('INSERT INTO credits (user_id, balance, total_earned) VALUES (?, 100, 100)', [userId]);
  await conn.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, reference_type)
     VALUES (?, 'bonus', 100, 100, 'Welcome bonus', 'system')`, [userId]
  );

  // Create demo API keys for demo user
  const demoKey1 = 'sgw_live_' + crypto.randomBytes(24).toString('hex');
  const demoKey2 = 'sgw_live_' + crypto.randomBytes(24).toString('hex');
  await conn.query(
    `INSERT INTO api_keys (user_id, name, key_value, credit_limit) VALUES (?, 'Production Key', ?, 0)`, [userId, demoKey1]
  );
  await conn.query(
    `INSERT INTO api_keys (user_id, name, key_value, credit_limit) VALUES (?, 'Testing Key', ?, 50)`, [userId, demoKey2]
  );
  console.log('Created: demo user (demo@saasgateway.local / user123)');
  console.log('   API Keys: ' + demoKey1 + ', ' + demoKey2);

  // Create demo APIs (admin-owned)
  const apis = [
    { name: 'User Management', slug: 'user-management', desc: 'CRUD operations for user data', cost: 1 },
    { name: 'Weather API', slug: 'weather-api', desc: 'Real-time weather data by city', cost: 2 },
    { name: 'Currency Exchange', slug: 'currency-exchange', desc: 'Live currency exchange rates', cost: 1 },
  ];

  for (const a of apis) {
    const apiUuid = uuidv4();
    await conn.query(`
      INSERT INTO apis (uuid, name, slug, description, version, status, credit_cost, rate_limit_per_minute, base_route, auth_required, is_public)
      VALUES (?, ?, ?, ?, '1.0.0', 'active', ?, 500, ?, 1, 1)
    `, [apiUuid, a.name, a.slug, a.desc, a.cost, `/api/v1/${a.slug}`]);
  }

  // Add sample routes to User Management API
  const [userMgmtApi] = await conn.query('SELECT id FROM apis WHERE slug = ?', ['user-management']);
  if (userMgmtApi.length > 0) {
    const apiId = userMgmtApi[0].id;

    await conn.query(`
      INSERT INTO api_routes (api_id, method, path, handler_code, description, sample_response, is_active)
      VALUES (?, 'GET', '/list', 'const [rows] = await db.query(\"SELECT id, username, email, full_name, created_at FROM users WHERE deleted_at IS NULL LIMIT 50\");\nreturn { status: 200, data: rows };', 'List all users', '{"status":200,"data":[{"id":1,"username":"demo"}]}', 1)
    `, [apiId]);

    await conn.query(`
      INSERT INTO api_routes (api_id, method, path, handler_code, description, sample_response, is_active)
      VALUES (?, 'GET', '/detail', 'const userId = req.query.id;\nif (!userId) return { status: 400, data: { error: \"id required\" } };\nconst [rows] = await db.query(\"SELECT id, username, email, full_name, created_at FROM users WHERE id = ?\", [userId]);\nif (!rows.length) return { status: 404, data: { error: \"User not found\" } };\nreturn { status: 200, data: rows[0] };', 'Get user detail by id', '{"status":200,"data":{"id":1,"username":"demo"}}', 1)
    `, [apiId]);

    await conn.query(`
      INSERT INTO api_routes (api_id, method, path, handler_code, description, sample_response, is_active)
      VALUES (?, 'POST', '/create', "const { username, email, full_name } = req.body;\nif (!username || !email) return { status: 400, data: { error: 'username and email required' } };\nconst uuid = require('uuid').v4();\nconst bcrypt = require('bcryptjs');\nconst hash = await bcrypt.hash('default123', 12);\nconst [result] = await db.query(\"INSERT INTO users (uuid, username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, 'user')\", [uuid, username, email, hash, full_name || username]);\nreturn { status: 201, data: { id: result.insertId, username, email } };", 'Create a new user', '{"status":201,"data":{"id":2,"username":"newuser","email":"new@example.com"}}', 1)
    `, [apiId]);
  }

  // Add sample routes to Weather API
  const [weatherApi] = await conn.query('SELECT id FROM apis WHERE slug = ?', ['weather-api']);
  if (weatherApi.length > 0) {
    const apiId = weatherApi[0].id;

    await conn.query(`
      INSERT INTO api_routes (api_id, method, path, handler_code, description, sample_response, is_active)
      VALUES (?, 'GET', '/current', 'const city = req.query.city || "Jakarta";\ntry {\n  const data = await httpGet("https://wttr.in/" + encodeURIComponent(city) + "?format=j1");\n  return { status: 200, data: { city, temp_c: data.current_condition?.[0]?.temp_C, description: data.current_condition?.[0]?.weatherDesc?.[0]?.value, humidity: data.current_condition?.[0]?.humidity } };\n} catch(e) { return { status: 500, data: { error: "Weather service unavailable" } }; }', 'Get current weather by city', '{"status":200,"data":{"city":"Jakarta","temp_c":"32","description":"Partly cloudy","humidity":"70"}}', 1)
    `, [apiId]);

    await conn.query(`
      INSERT INTO api_routes (api_id, method, path, handler_code, description, sample_response, is_active)
      VALUES (?, 'GET', '/forecast', 'const city = req.query.city || "Jakarta";\nconst days = parseInt(req.query.days) || 3;\ntry {\n  const data = await httpGet("https://wttr.in/" + encodeURIComponent(city) + "?format=j1");\n  const forecast = (data.weather || []).slice(0, days).map(d => ({ date: d.date, maxC: d.maxtempC, minC: d.mintempC }));\n  return { status: 200, data: { city, forecast } };\n} catch(e) { return { status: 500, data: { error: "Weather service unavailable" } }; }', 'Get weather forecast', '{"status":200,"data":{"city":"Jakarta","forecast":[{"date":"2024-01-01","maxC":"33","minC":"25"}]}}', 1)
    `, [apiId]);
  }

  console.log('Created: demo APIs with sample routes');

  console.log('\nDatabase v2 initialization complete!\n');
  console.log('Admin login:   admin@saasgateway.local / admin123');
  console.log('Demo login:    demo@saasgateway.local / user123');
  console.log('Demo API Key:  ' + demoKey1);
  console.log('');

  await conn.end();
  process.exit(0);
}

initDatabase().catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});
