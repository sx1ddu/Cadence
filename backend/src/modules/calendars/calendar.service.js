const { google } = require("googleapis");
const crypto = require("crypto");
const ApiError = require("../../utils/ApiError");
const env = require("../../config/env");
const { createOAuthClient, GOOGLE_CALENDAR_SCOPES } = require("../../config/googleOAuth");
const calendarRepo = require("./calendar.repository");

/**
 * The `state` parameter round-trips through Google's OAuth redirect, so
 * it's how we know WHICH user the callback is for (the browser hitting
 * our callback URL doesn't necessarily still carry our auth cookie, e.g.
 * if Google opens the consent screen in a different browser context).
 * We HMAC-sign it with our own secret so a forged state value (pointing
 * at someone else's account) is rejected — an attacker would need our
 * COOKIE_SECRET to produce a valid signature.
 */
function signState(userId) {
  const payload = `${userId}.${Date.now()}`;
  const signature = crypto.createHmac("sha256", env.cookieSecret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

function verifyState(state) {
  const decoded = Buffer.from(state, "base64url").toString("utf8");
  const [userId, timestamp, signature] = decoded.split(".");
  const payload = `${userId}.${timestamp}`;
  const expected = crypto.createHmac("sha256", env.cookieSecret).update(payload).digest("hex");
  if (expected !== signature) throw ApiError.unauthorized("Invalid OAuth state — possible CSRF attempt.");

  // 10-minute window to complete the consent flow.
  if (Date.now() - Number(timestamp) > 10 * 60 * 1000) {
    throw ApiError.badRequest("This connection link has expired. Please try connecting again.");
  }
  return Number(userId);
}

function getAuthUrl(userId) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // force showing consent screen every time, so we reliably get a refresh_token even on reconnect
    scope: GOOGLE_CALENDAR_SCOPES,
    state: signState(userId),
  });
}

async function handleOAuthCallback(code, state) {
  const userId = verifyState(state);

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw ApiError.badRequest(
      "Google didn't return a refresh token. This usually means the account was already connected once before — disconnect it in your Google Account's third-party access settings and try again."
    );
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data: userInfo } = await oauth2.userinfo.get();

  await calendarRepo.upsert({
    userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: new Date(tokens.expiry_date),
    calendarId: "primary",
    googleEmail: userInfo.email,
  });

  return { userId, googleEmail: userInfo.email };
}

/**
 * Builds an authenticated OAuth2 client for a user's stored credentials,
 * and wires up automatic token-refresh persistence: googleapis
 * transparently refreshes an expired access token using the refresh
 * token on the next API call, and fires a 'tokens' event with the new
 * one — without this listener, the refreshed token would only live in
 * memory for this one request and we'd re-hit the expired one (and
 * re-refresh, wastefully) on every subsequent call.
 */
async function getAuthorizedClient(userId) {
  const credential = await calendarRepo.findByUserId(userId);
  if (!credential) return null;

  const client = createOAuthClient();
  client.setCredentials({
    access_token: credential.access_token,
    refresh_token: credential.refresh_token,
    expiry_date: new Date(credential.expiry_date).getTime(),
  });

  client.on("tokens", async (newTokens) => {
    if (newTokens.access_token) {
      await calendarRepo.updateAccessToken(
        userId,
        "google",
        newTokens.access_token,
        new Date(newTokens.expiry_date)
      );
    }
  });

  return { client, credential };
}

async function isConnected(userId) {
  const credential = await calendarRepo.findByUserId(userId);
  return Boolean(credential);
}

async function disconnect(userId) {
  const credential = await calendarRepo.findByUserId(userId);
  if (!credential) return;

  // Best-effort token revocation with Google — not fatal if it fails
  // (e.g. the user already revoked it from their Google Account page).
  try {
    const client = createOAuthClient();
    await client.revokeToken(credential.refresh_token);
  } catch (err) {
    console.error("[calendar] token revocation failed (continuing anyway):", err.message);
  }

  await calendarRepo.remove(userId);
}

/**
 * Fetches busy periods from the user's Google Calendar for [fromDate,
 * toDate) — merged into the availability engine's busy-time calculation
 * (see availability.service.js) alongside Cadence's own bookings, so an
 * external meeting on the user's Google Calendar correctly blocks a
 * Cadence booking from being scheduled over it.
 *
 * Returns [] (not an error) if the user hasn't connected a calendar —
 * Google Calendar sync is opt-in, not required for the availability
 * engine to function.
 */
async function getBusyRanges(userId, fromDate, toDate) {
  const authorized = await getAuthorizedClient(userId);
  if (!authorized) return [];

  const calendar = google.calendar({ version: "v3", auth: authorized.client });

  try {
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: fromDate.toISOString(),
        timeMax: toDate.toISOString(),
        items: [{ id: authorized.credential.calendar_id }],
      },
    });
    const busy = data.calendars?.[authorized.credential.calendar_id]?.busy || [];
    return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch (err) {
    // Don't let a Google API hiccup take down availability computation
    // entirely — fail open (no external busy time known) rather than
    // failing the whole slots request.
    console.error(`[calendar] freebusy query failed for user ${userId}:`, err.message);
    return [];
  }
}

/** Creates a calendar event for a confirmed booking, returns the Google event id to store on the booking. */
async function createEventForBooking(userId, booking) {
  const authorized = await getAuthorizedClient(userId);
  if (!authorized) return null;

  const calendar = google.calendar({ version: "v3", auth: authorized.client });

  try {
    const { data } = await calendar.events.insert({
      calendarId: authorized.credential.calendar_id,
      requestBody: {
        summary: booking.title,
        description: `Booked via Cadence with ${booking.attendee_name} (${booking.attendee_email})`,
        start: { dateTime: new Date(booking.start_time).toISOString() },
        end: { dateTime: new Date(booking.end_time).toISOString() },
        attendees: [{ email: booking.attendee_email, displayName: booking.attendee_name }],
      },
    });
    return data.id;
  } catch (err) {
    console.error(`[calendar] failed to create event for booking ${booking.public_id}:`, err.message);
    return null;
  }
}

async function deleteEventForBooking(userId, googleEventId) {
  if (!googleEventId) return;
  const authorized = await getAuthorizedClient(userId);
  if (!authorized) return;

  const calendar = google.calendar({ version: "v3", auth: authorized.client });
  try {
    await calendar.events.delete({
      calendarId: authorized.credential.calendar_id,
      eventId: googleEventId,
    });
  } catch (err) {
    // Event may already be gone (deleted manually in Google Calendar) — not fatal.
    console.error(`[calendar] failed to delete event ${googleEventId}:`, err.message);
  }
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  isConnected,
  disconnect,
  getBusyRanges,
  createEventForBooking,
  deleteEventForBooking,
};
