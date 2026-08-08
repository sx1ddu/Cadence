-- Date-specific overrides for a schedule: either "closed all day" (holiday,
-- day off) or "different hours than usual" for one specific date. These
-- always win over the recurring weekly rules in availability_rules for
-- that date.
CREATE TABLE schedule_overrides (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  schedule_id    BIGINT UNSIGNED NOT NULL,
  date           DATE NOT NULL,
  is_unavailable TINYINT(1) NOT NULL DEFAULT 0,
  start_time     TIME NULL,   -- NULL when is_unavailable = 1
  end_time       TIME NULL,   -- NULL when is_unavailable = 1
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_schedule_overrides_schedule_date (schedule_id, date),
  CONSTRAINT fk_schedule_overrides_schedule
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
