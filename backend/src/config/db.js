/**
 * MySQL connection pool (mysql2/promise).
 *
 * Every query in this app goes through `pool.query()` or `pool.getConnection()`
 * directly from this module — there is no ORM layer translating JS objects
 * into SQL. Repositories write real SQL, which keeps the query plan visible
 * and debuggable.
 */
const mysql = require("mysql2/promise");
const env = require("./env");

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
  dateStrings: false, // we want JS Date objects back, not raw strings
  namedPlaceholders: false,
  decimalNumbers: true,
});

/**
 * Runs `work(connection)` inside a transaction.
 * Commits on success, rolls back and rethrows on any error.
 *
 * Usage:
 *   const result = await withTransaction(async (conn) => {
 *     await conn.query('INSERT INTO ...', [...]);
 *     await conn.query('UPDATE ...', [...]);
 *     return something;
 *   });
 */
async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function pingDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction, pingDatabase };
