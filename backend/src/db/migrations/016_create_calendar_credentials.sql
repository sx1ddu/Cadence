-- A connected Google Calendar account for a user. Tokens are stored
-- ENCRYPTED (see utils/crypto.js) — never store OAuth tokens in plain
-- text, since this table alone would otherwise be enough to impersonate
-- the user's calendar access if the database ever leaked.
--
-- One row per user for now (a user connects ONE Google account) — Cal.com
-- supports multiple connected calendars per user, but that adds real
-- complexity (which calendar is the "destination" for new events, per-
-- calendar selective sync) for limited teaching value at this scope.
CREATE TABLE calendar_credentials (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL,
  provider          ENUM('google') NOT NULL DEFAULT 'google',
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expiry_date       DATETIME NOT NULL,
  calendar_id       VARCHAR(255) NOT NULL DEFAULT 'primary',
  google_email      VARCHAR(255) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_calendar_credentials_user (user_id, provider),
  CONSTRAINT fk_calendar_credentials_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Links a booking to the Google Calendar event created for it, so we can
-- update/delete that specific event when the booking is rescheduled or
-- cancelled, and so we know NOT to double-create an event for a booking
-- that already has one.
ALTER TABLE bookings
  ADD COLUMN google_calendar_event_id VARCHAR(255) NULL AFTER location;
