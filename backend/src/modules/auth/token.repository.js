const { pool } = require("../../config/db");

// ─── Refresh tokens ─────────────────────────────────────────────

async function createRefreshToken({ userId, tokenHash, userAgent, ipAddress, expiresAt }) {
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, tokenHash, userAgent || null, ipAddress || null, expiresAt]
  );
}

async function findActiveRefreshToken(tokenHash) {
  const [rows] = await pool.query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function revokeRefreshToken(tokenHash) {
  await pool.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?", [tokenHash]);
}

async function revokeAllRefreshTokensForUser(userId) {
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
    [userId]
  );
}

// ─── Email verification tokens ─────────────────────────────────

async function createEmailVerificationToken({ userId, tokenHash, expiresAt }) {
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

async function findActiveEmailVerificationToken(tokenHash) {
  const [rows] = await pool.query(
    `SELECT * FROM email_verification_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markEmailVerificationTokenUsed(id) {
  await pool.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?", [id]);
}

// ─── Password reset tokens ──────────────────────────────────────

async function createPasswordResetToken({ userId, tokenHash, expiresAt }) {
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

async function findActivePasswordResetToken(tokenHash) {
  const [rows] = await pool.query(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markPasswordResetTokenUsed(id) {
  await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?", [id]);
}

module.exports = {
  createRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  createEmailVerificationToken,
  findActiveEmailVerificationToken,
  markEmailVerificationTokenUsed,
  createPasswordResetToken,
  findActivePasswordResetToken,
  markPasswordResetTokenUsed,
};
