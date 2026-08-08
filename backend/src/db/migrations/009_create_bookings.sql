-- A Booking is a confirmed (or pending) meeting between a host and an
-- attendee, created against a specific event type.
--
-- We snapshot `title` and `duration_minutes` from the event type at
-- booking time (instead of only storing event_type_id and joining) so
-- that if the host edits or deletes the event type later, past bookings
-- still show what was actually agreed to.
--
-- `host_user_id` is denormalized (technically derivable via event_type_id)
-- so conflict-checking queries ("what is this host busy with between X
-- and Y") don't need to join through event_types at all — this is the
-- single most frequent query in the whole system, so it gets its own
-- indexed column.
CREATE TABLE bookings (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id          CHAR(36) NOT NULL,
  event_type_id      BIGINT UNSIGNED NOT NULL,
  host_user_id       BIGINT UNSIGNED NOT NULL,

  title              VARCHAR(150) NOT NULL,
  duration_minutes   SMALLINT UNSIGNED NOT NULL,
  start_time         DATETIME NOT NULL, -- always stored in UTC
  end_time           DATETIME NOT NULL, -- always stored in UTC

  attendee_name      VARCHAR(120) NOT NULL,
  attendee_email     VARCHAR(255) NOT NULL,
  attendee_timezone  VARCHAR(100) NOT NULL,
  answers            JSON NOT NULL,      -- booking-question responses, keyed by question id
  location           JSON NOT NULL,      -- the single location chosen for this booking

  status             ENUM('pending', 'confirmed', 'cancelled', 'rejected') NOT NULL DEFAULT 'confirmed',
  cancellation_reason TEXT NULL,
  cancelled_by       ENUM('host', 'attendee') NULL,

  price_amount       INT UNSIGNED NULL,
  currency           CHAR(3) NULL,
  payment_status     ENUM('not_required', 'pending', 'paid', 'refunded') NOT NULL DEFAULT 'not_required',

  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_bookings_public_id (public_id),
  KEY idx_bookings_host_conflict (host_user_id, status, start_time, end_time),
  KEY idx_bookings_event_type (event_type_id),
  KEY idx_bookings_attendee_email (attendee_email),
  CONSTRAINT fk_bookings_event_type
    FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_host
    FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_bookings_time_order CHECK (start_time < end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
