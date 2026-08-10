const { pool } = require("../../config/db");

// ─── Refresh tokens ─────────────────────────────────────────────

async function createRefreshToken({ userId, tokenHash, userAgent, ipAddress, expiresAt }) {
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, tokenHash, userAgent || null, ipAddress || null, expiresAt]
  );
}

/**
 * Atomically revokes an active refresh token and returns the row that was
 * revoked, or null if it wasn't found/already revoked/expired.
 *
 * This replaces the old find-then-revoke pattern (a SELECT to check the
 * token is active, followed by a separate UPDATE to revoke it), which had
 * a real race: two simultaneous refresh requests using the SAME token
 * (e.g. a stolen refresh token used concurrently with the legitimate
 * one, or a double-submitted request) could both pass the SELECT check
 * before either UPDATE ran, and both would get issued a brand new token
 * pair from what should be a single-use token.
 *
 * The fix is a single atomic UPDATE ... WHERE revoked_at IS NULL: MySQL
 * guarantees only one concurrent UPDATE can match a given row's
 * `revoked_at IS NULL` condition and flip it — the second one, running
 * after the first commits, sees revoked_at already set and matches zero
 * rows. `affectedRows` tells us which request "won" the race; the loser
 * gets null back and should treat this exactly like an invalid token
 * (which, functionally, is what a reused refresh token is).
 */
async function claimRefreshToken(tokenHash) {
  const [result] = await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await pool.query("SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1", [
    tokenHash,
  ]);
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

/**
 * Same atomic claim pattern as claimRefreshToken: a single
 * UPDATE ... WHERE used_at IS NULL closes the race where two
 * simultaneous "verify email" requests with the same token (e.g. an
 * email client that pre-fetches links, or a double-clicked button) could
 * otherwise both read "not yet used" before either write landed.
 * Functionally low-stakes here (verifying twice is harmless), but making
 * it atomic costs nothing and means `affectedRows` gives a precise
 * signal instead of a best-effort guess.
 */
async function claimEmailVerificationToken(tokenHash) {
  const [result] = await pool.query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await pool.query(
    "SELECT * FROM email_verification_tokens WHERE token_hash = ? LIMIT 1",
    [tokenHash]
  );
  return rows[0] || null;
}

// ─── Password reset tokens ──────────────────────────────────────

async function createPasswordResetToken({ userId, tokenHash, expiresAt }) {
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

/**
 * Same atomic claim pattern again. This one matters more than email
 * verification: without it, two concurrent "reset password" submissions
 * with the same token could both pass the check, both change the
 * password (to two different values), and the second write silently
 * wins — confusing for the user and a real (if narrow) integrity issue.
 */
async function claimPasswordResetToken(tokenHash) {
  const [result] = await pool.query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await pool.query(
    "SELECT * FROM password_reset_tokens WHERE token_hash = ? LIMIT 1",
    [tokenHash]
  );
  return rows[0] || null;
}

module.exports = {
  createRefreshToken,
  claimRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  createEmailVerificationToken,
  claimEmailVerificationToken,
  createPasswordResetToken,
  claimPasswordResetToken,
};
