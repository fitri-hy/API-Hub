const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'saas_gateway',

  waitForConnections:
    process.env.DB_WAIT_FOR_CONNECTIONS !== 'false',

  connectionLimit:
    Number(process.env.DB_CONNECTION_LIMIT) || 20,

  queueLimit:
    Number(process.env.DB_QUEUE_LIMIT) || 0,

  enableKeepAlive:
    process.env.DB_ENABLE_KEEP_ALIVE !== 'false',

  keepAliveInitialDelay:
    Number(process.env.DB_KEEP_ALIVE_INITIAL_DELAY) || 0,

  namedPlaceholders:
    process.env.DB_NAMED_PLACEHOLDERS !== 'false',

  charset:
    process.env.DB_CHARSET || 'utf8mb4',

  timezone:
    process.env.DB_TIMEZONE || '+07:00',

  dateStrings:
    process.env.DB_DATE_STRINGS === 'true',

  typeCast: (field, next) => {
    if (field.type === 'TINY' && field.length === 1) {
      return field.string() === '1';
    }

    return next();
  }
});

pool.getConnection()
  .then((conn) => {
    console.log('Database connected successfully');
    conn.release();
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;