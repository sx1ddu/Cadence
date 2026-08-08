const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/db");

/**
 * Public shape of a user we're comfortable returning from the API.
 * Never spread the raw DB row into a response — always pass it through
 * this so password_hash (and anything else added later) can't leak.
 */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.public_id,
    name: row.name,
    username: row.username,
    email: row.email,
    timezone: row.timezone,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    role: row.role,
    emailVerified: Boolean(row.email_verified_at),
    createdAt: row.created_at,
  };
}

/** Shape shown on a user's PUBLIC booking page — no email, no role, no verification status. */
function toPublicProfile(row) {
  if (!row) return null;
  return {
    name: row.name,
    username: row.username,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
  };
}

async function findByEmail(email) {
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  return rows[0] || null;
}

async function findByUsername(username) {
  const [rows] = await pool.query("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function findByPublicId(publicId) {
  const [rows] = await pool.query("SELECT * FROM users WHERE public_id = ? LIMIT 1", [publicId]);
  return rows[0] || null;
}

async function createUser({ name, username, email, passwordHash, timezone }) {
  const publicId = uuidv4();
  const [result] = await pool.query(
    `INSERT INTO users (public_id, name, username, email, password_hash, timezone)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [publicId, name, username, email, passwordHash, timezone || "UTC"]
  );
  return findById(result.insertId);
}

async function markEmailVerified(userId) {
  await pool.query("UPDATE users SET email_verified_at = NOW() WHERE id = ?", [userId]);
}

async function updatePasswordHash(userId, passwordHash) {
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
}

const PROFILE_COLUMN_MAP = {
  name: "name",
  username: "username",
  bio: "bio",
  timezone: "timezone",
  avatarUrl: "avatar_url",
};

async function updateProfile(userId, data) {
  const fields = [];
  const values = [];
  for (const [key, column] of Object.entries(PROFILE_COLUMN_MAP)) {
    if (data[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(data[key]);
  }
  if (fields.length === 0) return findById(userId);

  values.push(userId);
  await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
  return findById(userId);
}

module.exports = {
  toPublicUser,
  toPublicProfile,
  findByEmail,
  findByUsername,
  findById,
  findByPublicId,
  createUser,
  markEmailVerified,
  updatePasswordHash,
  updateProfile,
};
