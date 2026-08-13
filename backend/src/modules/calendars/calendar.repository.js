const { pool } = require("../../config/db");
const { encrypt, decrypt } = require("../../utils/crypto");

/** Decrypts the stored tokens — everywhere else in the app should only ever see plaintext tokens transiently, in memory. */
function decryptCredential(row) {
  if (!row) return null;
  return {
    ...row,
    access_token: decrypt(row.access_token_enc),
    refresh_token: decrypt(row.refresh_token_enc),
  };
}

async function findByUserId(userId, provider = "google") {
  const [rows] = await pool.query(
    "SELECT * FROM calendar_credentials WHERE user_id = ? AND provider = ? LIMIT 1",
    [userId, provider]
  );
  return decryptCredential(rows[0]);
}

/** Insert-or-replace — a user reconnecting Google simply overwrites their previous tokens. */
async function upsert({ userId, provider = "google", accessToken, refreshToken, expiryDate, calendarId, googleEmail }) {
  await pool.query(
    `INSERT INTO calendar_credentials
       (user_id, provider, access_token_enc, refresh_token_enc, expiry_date, calendar_id, google_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token_enc = VALUES(access_token_enc),
       refresh_token_enc = VALUES(refresh_token_enc),
       expiry_date = VALUES(expiry_date),
       calendar_id = VALUES(calendar_id),
       google_email = VALUES(google_email)`,
    [userId, provider, encrypt(accessToken), encrypt(refreshToken), expiryDate, calendarId, googleEmail]
  );
  return findByUserId(userId, provider);
}

/** Called after googleapis auto-refreshes an access token, to persist the new one. */
async function updateAccessToken(userId, provider, accessToken, expiryDate) {
  await pool.query(
    "UPDATE calendar_credentials SET access_token_enc = ?, expiry_date = ? WHERE user_id = ? AND provider = ?",
    [encrypt(accessToken), expiryDate, userId, provider]
  );
}

async function remove(userId, provider = "google") {
  await pool.query("DELETE FROM calendar_credentials WHERE user_id = ? AND provider = ?", [
    userId,
    provider,
  ]);
}

module.exports = { findByUserId, upsert, updateAccessToken, remove };
