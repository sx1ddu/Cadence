-- Password reset tokens. Same shape/logic as email verification tokens,
-- kept as a separate table (rather than a shared "tokens" table with a
-- `type` column) because the two have different lifetimes, different
-- consequences on use, and keeping them separate makes each query obvious
-- at a glance instead of always filtering by type.
CREATE TABLE password_reset_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_prt_token_hash (token_hash),
  KEY idx_prt_user (user_id),
  CONSTRAINT fk_prt_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
