const authService = require("./auth.service");
const { setAuthCookies, clearAuthCookies, REFRESH_TOKEN_COOKIE } = require("../../utils/cookies");
const asyncHandler = require("../../utils/asyncHandler");

function requestContext(req) {
  return { userAgent: req.headers["user-agent"], ipAddress: req.ip };
}

const signup = asyncHandler(async (req, res) => {
  const user = await authService.signup(req.body);
  res.status(201).json({
    success: true,
    message: "Account created. Please check your email to verify your address.",
    data: { user },
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.body.token);
  res.json({ success: true, message: "Email verified successfully. You can now log in." });
});

const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerificationEmail(req.body.email);
  res.json({
    success: true,
    message: "If an account with that email exists and isn't verified yet, we've sent a new link.",
  });
});

const login = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.login(req.body, requestContext(req));
  setAuthCookies(res, tokens);
  res.json({ success: true, data: { user, accessToken: tokens.accessToken } });
});

const refresh = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.signedCookies?.[REFRESH_TOKEN_COOKIE];
  const { user, tokens } = await authService.refreshTokens(rawRefreshToken, requestContext(req));
  setAuthCookies(res, tokens);
  res.json({ success: true, data: { user, accessToken: tokens.accessToken } });
});

const logout = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.signedCookies?.[REFRESH_TOKEN_COOKIE];
  await authService.logout(rawRefreshToken);
  clearAuthCookies(res);
  res.json({ success: true, message: "Logged out." });
});

const logoutAllDevices = asyncHandler(async (req, res) => {
  await authService.logoutAllDevices(req.dbUser.id);
  clearAuthCookies(res);
  res.json({ success: true, message: "Logged out of all devices." });
});

const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  res.json({
    success: true,
    message: "If an account with that email exists, we've sent a password reset link.",
  });
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.json({ success: true, message: "Password reset successfully. Please log in again." });
});

const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

module.exports = {
  signup,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  logoutAllDevices,
  forgotPassword,
  resetPassword,
  me,
};
