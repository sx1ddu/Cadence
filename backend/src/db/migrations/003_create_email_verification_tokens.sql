-- Email verification tokens.
-- A new signup gets one of these; clicking the emailed link consumes it
-- (sets used_at) and marks users.email_verified_at.
CREATE TABLE email_verification_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_evt_token_hash (token_hash),
  KEY idx_evt_user (user_id),
  CONSTRAINT fk_evt_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
