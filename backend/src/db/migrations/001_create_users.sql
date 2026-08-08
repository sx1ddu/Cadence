-- Core identity table.
--
-- `id` is the internal, sequential primary key used for foreign keys and
-- joins (fast, small indexes). `public_id` is a UUID exposed in API
-- responses/URLs instead, so we never leak "how many users we have" or let
-- clients guess adjacent user IDs.
--
-- `username` is what makes a user's public booking page reachable, e.g.
-- /u/:username — mirrors Cal.com's username-based booking links.
CREATE TABLE users (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id         CHAR(36) NOT NULL,
  name              VARCHAR(120) NOT NULL,
  username          VARCHAR(50)  NOT NULL,
  email             VARCHAR(255) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  timezone          VARCHAR(100) NOT NULL DEFAULT 'UTC',
  bio               TEXT NULL,
  avatar_url        VARCHAR(500) NULL,
  role              ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  email_verified_at DATETIME NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
