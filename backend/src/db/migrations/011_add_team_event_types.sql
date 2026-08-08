-- Extends event_types to support TEAM event types, on top of the
-- existing personal (single-owner) event types.
--
-- `team_id` is nullable: NULL means "personal event type", exactly as
-- before — nothing about existing personal event types changes.
--
-- `scheduling_type` only applies when team_id is set:
--   COLLECTIVE  - every assigned host must be free; the meeting includes all of them
--   ROUND_ROBIN - any one assigned host being free is enough; one host is picked per booking
--
-- `seats_per_slot` supports "group events" (e.g. a webinar): when set to a
-- value greater than 1, the SAME start time can accept multiple
-- independent bookings up to that capacity, instead of the first booking
-- exclusively claiming the slot. NULL/1 means the normal one-attendee-
-- per-slot behavior everything so far already has.
ALTER TABLE event_types
  ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN scheduling_type ENUM('ROUND_ROBIN', 'COLLECTIVE') NULL AFTER team_id,
  ADD COLUMN seats_per_slot SMALLINT UNSIGNED NULL AFTER booking_limit_window,
  ADD KEY idx_event_types_team (team_id),
  ADD CONSTRAINT fk_event_types_team
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_event_types_team_scheduling
    CHECK ( (team_id IS NULL AND scheduling_type IS NULL) OR (team_id IS NOT NULL AND scheduling_type IS NOT NULL) );

-- Which users are assigned as hosts on a TEAM event type.
-- `priority` is used by round-robin selection as the first tiebreaker
-- (higher priority hosts are preferred); ties after that are broken by
-- who was booked longest ago (computed at booking time from the bookings
-- table, not stored here).
CREATE TABLE event_type_hosts (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type_id  BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  priority       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_event_type_hosts (event_type_id, user_id),
  KEY idx_event_type_hosts_user (user_id),
  CONSTRAINT fk_event_type_hosts_event_type
    FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_type_hosts_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
