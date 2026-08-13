const crypto = require("crypto");
const ApiError = require("../../utils/ApiError");
const razorpay = require("../../config/razorpay");
const env = require("../../config/env");
const paymentRepo = require("./payment.repository");
const bookingRepo = require("../bookings/booking.repository");
const emailQueue = require("../../jobs/queues/email.queue");
const userRepo = require("../users/user.repository");
const eventTypeRepo = require("../event-types/eventType.repository");

/**
 * Creates a Razorpay order for a booking that requires payment.
 *
 * This is a PUBLIC endpoint (like booking cancellation) — the booking's
 * public UUID is the capability token proving the caller is the person
 * who actually made this booking, since only they (and the host, via
 * email) ever see it.
 */
async function createOrderForBooking(bookingPublicId) {
  const booking = await bookingRepo.findByPublicId(bookingPublicId);
  if (!booking) throw ApiError.notFound("Booking not found.");

  if (!booking.price_amount) {
    throw ApiError.badRequest("This booking doesn't require payment.");
  }
  if (booking.payment_status === "paid") {
    throw ApiError.conflict("This booking has already been paid for.");
  }
  if (booking.status === "cancelled" || booking.status === "rejected") {
    throw ApiError.badRequest("This booking is no longer active.");
  }

  // Razorpay order amounts are in the smallest currency unit (paise for
  // INR), which is exactly how we already store price_amount — no
  // conversion needed.
  const order = await razorpay.orders.create({
    amount: booking.price_amount,
    currency: booking.currency,
    receipt: booking.public_id,
    notes: { bookingId: booking.public_id },
  });

  const payment = await paymentRepo.create({
    bookingId: booking.id,
    razorpayOrderId: order.id,
    amount: booking.price_amount,
    currency: booking.currency,
  });

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env.razorpay.keyId, // the PUBLIC key, safe to send to the client for the checkout widget
    payment: paymentRepo.toPublicPayment(payment),
  };
}

/**
 * Verifies a payment using Razorpay's documented HMAC formula for the
 * checkout success callback:
 *   HMAC_SHA256(order_id + "|" + payment_id, key_secret) === signature
 *
 * This NEVER trusts a client-provided "payment succeeded" claim on its
 * own — the signature can only have been produced by Razorpay itself
 * (using our secret key), so a forged request without a valid signature
 * is rejected outright.
 */
async function verifyPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    throw ApiError.badRequest("Payment verification failed: signature mismatch.");
  }

  const payment = await paymentRepo.findByRazorpayOrderId(razorpay_order_id);
  if (!payment) throw ApiError.notFound("No matching payment order found.");

  if (payment.status === "paid") {
    // Already processed (e.g. the webhook beat the client here) — treat
    // as success rather than erroring, since the end state is correct.
    return { verified: true, alreadyProcessed: true };
  }

  await paymentRepo.markPaid(payment.id, {
    razorpayPaymentId: razorpay_payment_id,
    razorpaySignature: razorpay_signature,
  });
  await bookingRepo.updatePaymentStatus(payment.booking_id, "paid");
  await sendPaymentConfirmedEmail(payment.booking_id);

  return { verified: true, alreadyProcessed: false };
}

/**
 * Handles Razorpay's server-to-server webhook — the reliable backstop in
 * case the client never calls verifyPayment (browser closed mid-checkout,
 * network drop, etc). Verifies the WEBHOOK signature (a different secret
 * and formula than the checkout signature above): HMAC_SHA256 of the raw
 * request body using RAZORPAY_WEBHOOK_SECRET.
 *
 * Idempotent by design: if the payment is already marked 'paid', a
 * duplicate webhook delivery (Razorpay retries on any non-2xx response,
 * and even sometimes delivers successful ones more than once) is a no-op
 * rather than re-sending confirmation emails or erroring.
 */
async function handleWebhook(rawBody, signatureHeader) {
  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (expectedSignature !== signatureHeader) {
    throw ApiError.unauthorized("Invalid webhook signature.");
  }

  const event = JSON.parse(rawBody.toString("utf8"));
  const eventType = event.event;

  if (eventType === "payment.captured") {
    const orderId = event.payload?.payment?.entity?.order_id;
    const paymentId = event.payload?.payment?.entity?.id;
    if (!orderId) return;

    const payment = await paymentRepo.findByRazorpayOrderId(orderId);
    if (!payment || payment.status === "paid") return; // unknown order, or already processed

    await paymentRepo.markPaid(payment.id, { razorpayPaymentId: paymentId, razorpaySignature: null });
    await bookingRepo.updatePaymentStatus(payment.booking_id, "paid");
    await sendPaymentConfirmedEmail(payment.booking_id);
  } else if (eventType === "payment.failed") {
    const orderId = event.payload?.payment?.entity?.order_id;
    if (!orderId) return;

    const payment = await paymentRepo.findByRazorpayOrderId(orderId);
    if (!payment || payment.status === "paid") return;

    await paymentRepo.markFailed(payment.id);
    await bookingRepo.updatePaymentStatus(payment.booking_id, "pending"); // stays pending, booker can retry
  }
  // Other event types (refund.processed, etc.) are intentionally
  // unhandled for now — refunds are triggered from our side via
  // refundPayment below, not driven by inbound webhook events yet.
}

/** Host-initiated refund — e.g. when cancelling a paid booking. */
async function refundPayment(bookingPublicId, hostUserId) {
  const booking = await bookingRepo.findByPublicId(bookingPublicId);
  if (!booking) throw ApiError.notFound("Booking not found.");
  if (booking.host_user_id !== hostUserId) throw ApiError.forbidden("This isn't your booking.");

  const payment = await paymentRepo.findLatestForBooking(booking.id);
  if (!payment || payment.status !== "paid") {
    throw ApiError.badRequest("There's no paid payment to refund for this booking.");
  }

  await razorpay.payments.refund(payment.razorpay_payment_id, {
    amount: payment.amount,
  });

  await paymentRepo.markRefunded(payment.id);
  await bookingRepo.updatePaymentStatus(booking.id, "refunded");

  return paymentRepo.toPublicPayment(await paymentRepo.findById(payment.id));
}

async function sendPaymentConfirmedEmail(bookingId) {
  const booking = await bookingRepo.findById(bookingId);
  if (!booking) return;
  const eventType = await eventTypeRepo.findById(booking.event_type_id);
  const host = eventType ? await userRepo.findById(eventType.user_id) : null;

  await emailQueue.add("payment-confirmed", {
    to: booking.attendee_email,
    recipientName: booking.attendee_name,
    title: booking.title,
    startTime: booking.start_time,
    timezone: booking.attendee_timezone,
    amount: booking.price_amount,
    currency: booking.currency,
  });

  if (host) {
    await emailQueue.add("payment-confirmed", {
      to: host.email,
      recipientName: host.name,
      title: booking.title,
      startTime: booking.start_time,
      timezone: host.timezone,
      amount: booking.price_amount,
      currency: booking.currency,
    });
  }
}

module.exports = { createOrderForBooking, verifyPayment, handleWebhook, refundPayment };
