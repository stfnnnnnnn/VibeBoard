import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var _mysqlPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
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
