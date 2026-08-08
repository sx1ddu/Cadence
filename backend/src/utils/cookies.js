const env = require("../config/env");

const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

const baseCookieOptions = {
  httpOnly: true,
  secure: env.isProduction, // requires HTTPS in production
  sameSite: "lax", // 'lax' allows the cookie on top-level navigations (e.g. email links) while blocking cross-site POSTs
  signed: true,
};

function accessTokenCookieOptions() {
  return { ...baseCookieOptions, maxAge: 15 * 60 * 1000 }; // 15 minutes
}

function refreshTokenCookieOptions() {
  return { ...baseCookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000, path: "/api/auth" }; // 30 days, scoped to auth routes
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions());
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshTokenCookieOptions());
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookieOptions });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseCookieOptions, path: "/api/auth" });
}

module.exports = {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
  clearAuthCookies,
};
