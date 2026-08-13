const { google } = require("googleapis");
const env = require("./env");

/** A fresh, unauthenticated OAuth2 client — used to build the consent URL and to exchange an auth code for tokens. */
function createOAuthClient() {
  return new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
}

const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

module.exports = { createOAuthClient, GOOGLE_CALENDAR_SCOPES };
