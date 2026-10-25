import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var _mysqlPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  const ca = process.env.DB_SSL_CA; // PEM text of the provider's CA cert (newlines may be literal "\n")
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: ca ? { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT) || 10,
    maxIdle: Number(process.env.DB_POOL_LIMIT) || 10,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    queueLimit: 0,
    timezone: '+08:00',
    dateStrings: true,
  });
}

// Reuse the pool across hot-reloads in development.
const pool: mysql.Pool = global._mysqlPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  global._mysqlPool = pool;
}

export default pool;
