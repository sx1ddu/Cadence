const bcrypt = require("bcrypt");
const crypto = require("crypto");

const SALT_ROUNDS = 12;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Generates a URL-safe random token (for email verification / password
 * reset links) and returns both the raw token (sent to the user) and its
 * SHA-256 hash (stored in the DB). We only ever store the hash — if the
 * database leaks, the tokens in it are useless without the raw value that
 * only ever existed in the email we sent.
 */
function generateSecureToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash };
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

module.exports = {
  hashPassword,
  comparePassword,
  generateSecureToken,
  hashToken,
};
