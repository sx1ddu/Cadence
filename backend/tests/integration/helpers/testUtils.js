/**
 * Shared helpers for integration tests.
 *
 * IMPORTANT: these tests hit a REAL, RUNNING Cadence API server backed by
 * a real MySQL database and real Redis instance — they are NOT mocked.
 * Run `npm run dev` (and `npm run worker` if a test needs to observe
 * email side effects) against a MIGRATED database before running these.
 *
 * Because email verification is required before login (see
 * auth.service.js), and these tests can't click a link in a real inbox,
 * `signupAndVerify` reaches directly into the database to read the
 * verification token's hash match rather than the raw token (which only
 * ever exists in the email). This is a pragmatic test-only shortcut: it
 * marks the user verified directly, the same end state a real click
 * would produce, without needing a mailbox.
 */
const mysql = require("mysql2/promise");
const { createClient } = require("./client");

let dbPool;

function getTestDbPool() {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "cadence",
    });
  }
  return dbPool;
}

let counter = 0;
/** Generates a unique-per-run username/email pair so repeated test runs never collide. */
function uniqueUser(prefix = "testuser") {
  counter += 1;
  const suffix = `${Date.now()}${counter}`;
  return {
    name: `Test User ${suffix}`,
    username: `${prefix}${suffix}`.toLowerCase().slice(0, 40),
    email: `${prefix}${suffix}@example.com`,
    password: "TestPass123",
  };
}

/** Signs a user up via the real API, then marks them verified directly in the DB (see module docstring). */
async function signupAndVerify(client, userInput = uniqueUser()) {
  const signupRes = await client.post("/api/auth/signup", {
    name: userInput.name,
    username: userInput.username,
    email: userInput.email,
    password: userInput.password,
    timezone: userInput.timezone || "UTC",
  });
  if (signupRes.status !== 201) {
    throw new Error(`signup failed: ${signupRes.status} ${JSON.stringify(signupRes.body)}`);
  }

  const pool = getTestDbPool();
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE email = ?", [userInput.email]);

  return userInput;
}

/** signupAndVerify + login in one call, returning the client already authenticated (cookies set). */
async function createLoggedInUser(prefix = "testuser") {
  const client = createClient();
  const userInput = uniqueUser(prefix);
  await signupAndVerify(client, userInput);

  const loginRes = await client.post("/api/auth/login", {
    email: userInput.email,
    password: userInput.password,
  });
  if (loginRes.status !== 200) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }

  return { client, user: userInput, publicUser: loginRes.body.data.user };
}

/** YYYY-MM-DD for N days from now, safely in the future for any test's minimum-notice settings. */
function daysFromNowStr(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Creates a personal event type with sensible defaults, overridable per test. */
async function createEventType(client, overrides = {}) {
  const res = await client.post("/api/event-types", {
    title: "Test Meeting",
    slug: `test-meeting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    durationMinutes: 30,
    locations: [{ type: "phone" }],
    minimumNoticeMinutes: 0,
    futureBookingDays: 60,
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`event type creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.eventType;
}

module.exports = {
  getTestDbPool,
  uniqueUser,
  signupAndVerify,
  createLoggedInUser,
  daysFromNowStr,
  createEventType,
};
