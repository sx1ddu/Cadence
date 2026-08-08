-- Recurring weekly working-hour blocks for a schedule.
--
-- `days` is a JSON array of weekday integers (0=Sunday .. 6=Saturday),
-- matching Cal.com's approach of grouping several days that share the same
-- start/end time into one row (e.g. Mon-Fri 09:00-17:00 is a single row
-- with days = [1,2,3,4,5]) instead of one row per day. MySQL has no native
-- integer-array column, so JSON is the simplest equivalent — and it's
-- trivial to read/write from JS as a plain array.
--
-- start_time/end_time are stored as TIME (hours:minutes:seconds, no date),
-- interpreted in the parent schedule's timezone.
CREATE TABLE availability_rules (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  schedule_id  BIGINT UNSIGNED NOT NULL,
  days         JSON NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_availability_rules_schedule (schedule_id),
  CONSTRAINT fk_availability_rules_schedule
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  CONSTRAINT chk_availability_rules_time_order CHECK (start_time < end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
