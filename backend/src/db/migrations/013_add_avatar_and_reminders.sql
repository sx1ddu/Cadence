-- Cloudinary stores an asset under a public_id; keeping it lets us delete
-- the OLD avatar from Cloudinary when a user uploads a new one, instead of
-- leaking orphaned images in their Cloudinary account forever.
ALTER TABLE users
  ADD COLUMN avatar_public_id VARCHAR(255) NULL AFTER avatar_url;

-- Tracks whether a reminder email has already gone out for a booking, so
-- the reminder sweep (see jobs/cron/sendReminders.js) never double-sends.
ALTER TABLE bookings
  ADD COLUMN reminder_sent_at DATETIME NULL AFTER updated_at;
