-- Every booking has one or more hosts who must be considered "busy" for
-- its duration:
--   - personal event type booking   -> exactly one row (the owner)
--   - round-robin team booking      -> exactly one row (the picked host)
--   - collective team booking       -> one row per assigned host
--
-- bookings.host_user_id (added in migration 009) is kept as-is and still
-- means "the primary host" — it's what powers the simple "my bookings"
-- dashboard query without a join. booking_hosts is the complete,
-- authoritative set used for conflict-checking (a collective booking
-- must block ALL of its hosts' calendars, not just the primary one).
CREATE TABLE booking_hosts (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_booking_hosts (booking_id, user_id),
  KEY idx_booking_hosts_user (user_id),
  CONSTRAINT fk_booking_hosts_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_hosts_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supports the seat-capacity check for group events: "how many active
-- bookings already exist for this exact (event_type_id, start_time)?"
CREATE INDEX idx_bookings_seat_capacity ON bookings (event_type_id, start_time, status);
