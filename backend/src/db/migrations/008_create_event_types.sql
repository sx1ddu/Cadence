-- An Event Type is the bookable "product" on a user's public page —
-- e.g. "30 Minute Meeting" or "Product Demo". Bookings are always created
-- against a specific event type, which defines the duration, where the
-- meeting happens, how far in advance it must be booked, and any custom
-- questions to ask the booker.
--
-- `locations` and `booking_questions` are JSON because they're small,
-- variable-shaped lists that are always read/written as a whole — a
-- separate join table would add joins for no real benefit here.
CREATE TABLE event_types (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id             CHAR(36) NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,
  schedule_id           BIGINT UNSIGNED NULL, -- NULL = fall back to the user's default schedule

  title                 VARCHAR(150) NOT NULL,
  slug                  VARCHAR(150) NOT NULL, -- URL-safe, unique per user: /:username/:slug
  description           TEXT NULL,
  duration_minutes      SMALLINT UNSIGNED NOT NULL,
  locations             JSON NOT NULL,   -- [{ "type": "google_meet" }, { "type": "phone" }, ...]
  booking_questions      JSON NOT NULL,   -- [{ "id": "notes", "label": "...", "type": "text", "required": false }]

  buffer_before_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  buffer_after_minutes  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  minimum_notice_minutes INT UNSIGNED NOT NULL DEFAULT 120,
  slot_interval_minutes SMALLINT UNSIGNED NULL, -- NULL = same as duration_minutes
  future_booking_days   SMALLINT UNSIGNED NOT NULL DEFAULT 60, -- how far ahead the calendar is open

  booking_limit_count   SMALLINT UNSIGNED NULL,
  booking_limit_window  ENUM('day', 'week', 'month') NULL,

  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,

  price_amount          INT UNSIGNED NULL,   -- smallest currency unit (e.g. paise); NULL = free
  currency              CHAR(3) NULL,        -- ISO 4217, e.g. "INR"

  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_event_types_public_id (public_id),
  UNIQUE KEY uq_event_types_user_slug (user_id, slug),
  KEY idx_event_types_user (user_id),
  KEY idx_event_types_schedule (schedule_id),
  CONSTRAINT fk_event_types_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_types_schedule
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL,
  CONSTRAINT chk_event_types_price
    CHECK ( (price_amount IS NULL AND currency IS NULL) OR (price_amount IS NOT NULL AND currency IS NOT NULL) )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
