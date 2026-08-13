const env = require("../../config/env");
const calendarService = require("./calendar.service");
const asyncHandler = require("../../utils/asyncHandler");

const getConnectUrl = asyncHandler(async (req, res) => {
  const url = calendarService.getAuthUrl(req.dbUser.id);
  res.json({ success: true, data: { url } });
});

/**
 * Google redirects the browser here directly after consent — this can't
 * assume req.dbUser is set (no guarantee our auth cookie survives the
 * round trip through Google's domain), so the user is identified via the
 * signed `state` parameter instead (see calendar.service.js).
 */
const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${env.clientUrl}/settings/calendars?error=${encodeURIComponent(error)}`);
  }

  await calendarService.handleOAuthCallback(code, state);
  res.redirect(`${env.clientUrl}/settings/calendars?connected=google`);
});

const getStatus = asyncHandler(async (req, res) => {
  const connected = await calendarService.isConnected(req.dbUser.id);
  res.json({ success: true, data: { google: { connected } } });
});

const disconnect = asyncHandler(async (req, res) => {
  await calendarService.disconnect(req.dbUser.id);
  res.json({ success: true, message: "Google Calendar disconnected." });
});

module.exports = { getConnectUrl, handleCallback, getStatus, disconnect };
