-- A webhook subscription: "send an HTTP POST to this URL whenever one of
-- these event types happens, for this user's bookings."
-- `event_types` is a JSON array of strings, e.g. ["booking.created",
-- "booking.cancelled"] — small, always-read-as-a-whole list, same
-- reasoning as event_types.locations elsewhere in this schema.
CREATE TABLE webhooks (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id    CHAR(36) NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  target_url   VARCHAR(500) NOT NULL,
  secret       VARCHAR(255) NOT NULL, -- used to HMAC-sign delivered payloads
  event_types  JSON NOT NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_webhooks_public_id (public_id),
  KEY idx_webhooks_user (user_id),
  CONSTRAINT fk_webhooks_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per delivery ATTEMPT, so a user can see "did my webhook fire,
-- and did the receiving server accept it" without needing to inspect
-- BullMQ/Redis directly.
CREATE TABLE webhook_deliveries (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  webhook_id    BIGINT UNSIGNED NOT NULL,
  event_type    VARCHAR(100) NOT NULL,
  payload       JSON NOT NULL,
  status        ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
  response_code SMALLINT UNSIGNED NULL,
  attempts      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_webhook_deliveries_webhook (webhook_id),
  CONSTRAINT fk_webhook_deliveries_webhook
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
