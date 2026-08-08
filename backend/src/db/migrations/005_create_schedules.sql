-- A named weekly availability template, e.g. "Working Hours" or "Weekends".
-- A user can have several; one is marked default and is what new event
-- types fall back to when they don't pick a specific schedule.
CREATE TABLE schedules (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id   CHAR(36) NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  timezone    VARCHAR(100) NOT NULL DEFAULT 'UTC',
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_schedules_public_id (public_id),
  KEY idx_schedules_user (user_id),
  CONSTRAINT fk_schedules_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
