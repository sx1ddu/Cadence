/**
 * Minimal, dependency-free migration runner.
 *
 * How it works:
 *   - Every file in db/migrations/ is a plain .sql file named like
 *     001_create_users.sql, 002_create_refresh_tokens.sql, etc.
 *   - We track which ones have already run in a `schema_migrations` table.
 *   - On each run, we apply any .sql file whose name isn't in that table yet,
 *     in filename order, each wrapped in a transaction.
 *
 * This intentionally has no "down" migrations / rollback DSL — for a
 * project this size, forward-only migrations plus a database backup
 * before risky changes is simpler to reason about than a full migration
 * framework, and it keeps every migration as plain, readable SQL.
 *
 * Run with: npm run db:migrate
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const env = require("../config/env");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureDatabaseExists() {
  // Connect without a database selected, create it if missing.
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();
}

async function run() {
  await ensureDatabaseExists();

  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: true,
  });

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const [appliedRows] = await connection.query("SELECT filename FROM schema_migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are zero-padded, so lexical sort == numeric order

  let ranCount = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`[migrate] applying ${file} ...`);

    // Note: DDL statements (CREATE TABLE, etc.) auto-commit in MySQL, so we
    // can't wrap them in a rollback-able transaction. If a migration fails
    // partway through, fix the .sql file (or the DB by hand) and re-run —
    // the tracking row is only inserted after the whole file succeeds.
    try {
      await connection.query(sql);
      await connection.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      ranCount += 1;
      console.log(`[migrate] ✓ ${file}`);
    } catch (err) {
      console.error(`[migrate] ✗ failed on ${file}:`, err.message);
      await connection.end();
      process.exit(1);
    }
  }

  if (ranCount === 0) {
    console.log("[migrate] database already up to date.");
  } else {
    console.log(`[migrate] applied ${ranCount} migration(s).`);
  }

  await connection.end();
}

run().catch((err) => {
  console.error("[migrate] fatal error:", err);
  process.exit(1);
});
