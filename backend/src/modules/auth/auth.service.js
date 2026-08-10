const dayjs = require("dayjs");
const jwt = require("jsonwebtoken");
const ApiError = require("../../utils/ApiError");
const { hashPassword, comparePassword, generateSecureToken, hashToken } = require("../../utils/password");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../../utils/jwt");
const env = require("../../config/env");
const emailQueue = require("../../jobs/queues/email.queue");
const userRepo = require("../users/user.repository");
const tokenRepo = require("./token.repository");

const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 1;

/**
 * Builds the { accessToken, refreshToken } pair for a user and persists
 * the refresh token (hashed) so it can be looked up / revoked later.
 * Called on both login and refresh (token rotation).
 */
async function issueTokenPair(user, { userAgent, ipAddress } = {}) {
  const claims = { sub: user.public_id, role: user.role };

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken(claims);

  const refreshTokenHash = hashToken(refreshToken);

  // Read the expiry straight off the token we just signed (its `exp` claim,
  // in seconds since epoch) rather than re-deriving it from
  // JWT_REFRESH_EXPIRES_IN — this way the DB row can never drift out of
  // sync with what the JWT itself says.
  const { exp } = jwt.decode(refreshToken);
  const expiresAt = dayjs.unix(exp).toDate();

  await tokenRepo.createRefreshToken({
    userId: user.id,
    tokenHash: refreshTokenHash,
    userAgent,
    ipAddress,
    expiresAt,
  });

  return { accessToken, refreshToken };
}

async function signup({ name, username, email, password, timezone }) {
  const existingEmail = await userRepo.findByEmail(email);
  if (existingEmail) throw ApiError.conflict("An account with this email already exists.");

  const existingUsername = await userRepo.findByUsername(username);
  if (existingUsername) throw ApiError.conflict("This username is already taken.");

  const passwordHash = await hashPassword(password);
  const user = await userRepo.createUser({ name, username, email, passwordHash, timezone });

  await sendVerificationEmail(user);

  return userRepo.toPublicUser(user);
}

async function sendVerificationEmail(user) {
  const { rawToken, tokenHash } = generateSecureToken();
  const expiresAt = dayjs().add(EMAIL_VERIFICATION_TTL_HOURS, "hour").toDate();

  await tokenRepo.createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt });

  const verifyUrl = `${env.clientUrl}/verify-email?token=${rawToken}`;

  await emailQueue.add("verify-email", {
    to: user.email,
    name: user.name,
    verifyUrl,
  });
}

async function resendVerificationEmail(email) {
  const user = await userRepo.findByEmail(email);
  // Deliberately don't reveal whether the email exists — same response either way.
  if (!user || user.email_verified_at) return;
  await sendVerificationEmail(user);
}

async function verifyEmail(rawToken) {
  const tokenHash = hashToken(rawToken);
  const record = await tokenRepo.claimEmailVerificationToken(tokenHash);
  if (!record) throw ApiError.badRequest("This verification link is invalid or has expired.");

  await userRepo.markEmailVerified(record.user_id);
}

async function login({ email, password }, context) {
  const user = await userRepo.findByEmail(email);
  // Same error for "no such user" and "wrong password" — don't leak which one it was.
  if (!user) throw ApiError.unauthorized("Invalid email or password.");

  const passwordMatches = await comparePassword(password, user.password_hash);
  if (!passwordMatches) throw ApiError.unauthorized("Invalid email or password.");

  if (!user.is_active) throw ApiError.forbidden("This account has been deactivated.");

  const tokens = await issueTokenPair(user, context);
  return { user: userRepo.toPublicUser(user), tokens };
}

/**
 * Refresh token rotation: the incoming refresh token is verified and
 * atomically claimed (checked-and-revoked in one step — see
 * token.repository.claimRefreshToken for why this needs to be atomic),
 * then replaced with a brand new pair. This limits the damage if a
 * refresh token is ever stolen — it's single-use, and reuse (by an
 * attacker or by a race) is rejected outright.
 */
async function refreshTokens(rawRefreshToken, context) {
  if (!rawRefreshToken) throw ApiError.unauthorized("Missing refresh token.");

  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token.");
  }

  const tokenHash = hashToken(rawRefreshToken);
  const record = await tokenRepo.claimRefreshToken(tokenHash);
  if (!record) throw ApiError.unauthorized("This session has been revoked. Please log in again.");

  const user = await userRepo.findByPublicId(payload.sub);
  if (!user || !user.is_active) throw ApiError.unauthorized("Account not found or inactive.");

  const tokens = await issueTokenPair(user, context);

  return { user: userRepo.toPublicUser(user), tokens };
}

async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return;
  await tokenRepo.revokeRefreshToken(hashToken(rawRefreshToken));
}

async function logoutAllDevices(userId) {
  await tokenRepo.revokeAllRefreshTokensForUser(userId);
}

async function forgotPassword(email) {
  const user = await userRepo.findByEmail(email);
  if (!user) return; // don't reveal whether the account exists

  const { rawToken, tokenHash } = generateSecureToken();
  const expiresAt = dayjs().add(PASSWORD_RESET_TTL_HOURS, "hour").toDate();

  await tokenRepo.createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });

  const resetUrl = `${env.clientUrl}/reset-password?token=${rawToken}`;

  await emailQueue.add("password-reset", {
    to: user.email,
    name: user.name,
    resetUrl,
  });
}

async function resetPassword(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);
  const record = await tokenRepo.claimPasswordResetToken(tokenHash);
  if (!record) throw ApiError.badRequest("This reset link is invalid or has expired.");

  const passwordHash = await hashPassword(newPassword);
  await userRepo.updatePasswordHash(record.user_id, passwordHash);

  // Invalidate every existing session — if an attacker had a stolen
  // refresh token, a password reset should kick them out too.
  await tokenRepo.revokeAllRefreshTokensForUser(record.user_id);
}

module.exports = {
  signup,
  sendVerificationEmail,
  resendVerificationEmail,
  verifyEmail,
  login,
  issueTokenPair,
  refreshTokens,
  logout,
  logoutAllDevices,
  forgotPassword,
  resetPassword,
};
