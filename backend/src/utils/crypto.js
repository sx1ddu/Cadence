/**
 * AES-256-GCM encryption for secrets we must store but never want sitting
 * in the database as plain text — right now, that's Google OAuth tokens.
 *
 * GCM gives us both confidentiality AND tamper detection (the auth tag):
 * if someone edits the ciphertext in the database directly, decryption
 * fails loudly instead of silently returning garbage that might get sent
 * to Google's API as a "valid" token.
 */
const crypto = require("crypto");
const env = require("../config/env");

const ALGORITHM = "aes-256-gcm";

function getKey() {
  // ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex chars) —
  // generate one with `openssl rand -hex 32`.
  const key = Buffer.from(env.encryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes).");
  }
  return key;
}

function encrypt(plainText) {
  const iv = crypto.randomBytes(12); // GCM's recommended IV length
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together, as one hex string, so the
  // database column only needs to hold a single opaque value.
  return Buffer.concat([iv, authTag, encrypted]).toString("hex");
}

function decrypt(encryptedHex) {
  const data = Buffer.from(encryptedHex, "hex");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
