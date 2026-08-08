const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/jwt");
const { ACCESS_TOKEN_COOKIE } = require("../utils/cookies");
const userRepo = require("../modules/users/user.repository");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Reads the access token from the httpOnly cookie (browser clients) or
 * the Authorization header (API clients / mobile apps), verifies it,
 * loads the user, and attaches it as `req.user` (public shape) and
 * `req.dbUser` (full row, for internal use like req.dbUser.id in FK
 * queries).
 */
function getTokenFromRequest(req) {
  if (req.signedCookies?.[ACCESS_TOKEN_COOKIE]) {
    return req.signedCookies[ACCESS_TOKEN_COOKIE];
  }
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7);
  }
  return null;
}

const authenticate = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) throw ApiError.unauthorized("Authentication required.");

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired access token.");
  }

  const user = await userRepo.findByPublicId(payload.sub);
  if (!user || !user.is_active) throw ApiError.unauthorized("Account not found or inactive.");

  req.dbUser = user;
  req.user = userRepo.toPublicUser(user);
  next();
});

/** Optional variant: attaches req.user if a valid token is present, but never throws. */
const attachUserIfPresent = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await userRepo.findByPublicId(payload.sub);
    if (user && user.is_active) {
      req.dbUser = user;
      req.user = userRepo.toPublicUser(user);
    }
  } catch {
    // ignore invalid/expired tokens in this variant
  }
  next();
});

/** Role guard — use after `authenticate`. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden("You do not have permission to perform this action."));
    }
    next();
  };
}

module.exports = { authenticate, attachUserIfPresent, requireRole };
