-- One row per issued refresh token.
--
-- We never store the raw JWT — only a SHA-256 hash of it — so a leaked
-- database dump alone can't be used to impersonate anyone. Each row
-- represents one "session" (e.g. one browser). This lets us support:
--   - logout (revoke this one token)
--   - "log out of all devices" (revoke every token for a user)
--   - refresh token rotation (each refresh issues a new row and revokes the old one)
CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64) NOT NULL,          -- sha256 hex digest
  user_agent   VARCHAR(255) NULL,
  ip_address   VARCHAR(45) NULL,           -- IPv6-safe length
  revoked_at   DATETIME NULL,
  expires_at   DATETIME NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_user (user_id),
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
