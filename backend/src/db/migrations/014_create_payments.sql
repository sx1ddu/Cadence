-- One row per Razorpay order created for a booking. A booking can end up
-- with more than one row here if a payment attempt fails and the booker
-- retries (a fresh order is created each time) — `bookings.payment_status`
-- always reflects the CURRENT summary state, while this table is the full
-- history, useful for support/audit and for safely handling Razorpay
-- webhooks that might arrive more than once (see idempotency note below).
CREATE TABLE payments (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id           CHAR(36) NOT NULL,
  booking_id          BIGINT UNSIGNED NOT NULL,

  razorpay_order_id   VARCHAR(64) NOT NULL,
  razorpay_payment_id VARCHAR(64) NULL,
  razorpay_signature  VARCHAR(255) NULL,

  amount              INT UNSIGNED NOT NULL,  -- smallest currency unit (paise), matches bookings.price_amount
  currency             CHAR(3) NOT NULL,
  status               ENUM('created', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'created',

  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_payments_public_id (public_id),
  UNIQUE KEY uq_payments_razorpay_order (razorpay_order_id),
  KEY idx_payments_booking (booking_id),
  CONSTRAINT fk_payments_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
