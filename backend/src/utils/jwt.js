/**
 * JWT helpers.
 *
 * We use TWO secrets on purpose:
 *   - access tokens are short-lived (15 min) and sent as a Bearer token /
 *     httpOnly cookie on every request.
 *   - refresh tokens are long-lived (30 days), stored ONLY in an httpOnly
 *     cookie, and are also persisted (hashed) in the `refresh_tokens` table
 *     so we can revoke them individually (logout, password change, etc.)
 *     Using a different secret means a leaked access token can never be
 *     used to forge a refresh token, and vice versa.
 */
const jwt = require("jsonwebtoken");
const env = require("../config/env");

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};
