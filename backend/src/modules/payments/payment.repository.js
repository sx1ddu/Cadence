const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/db");

function toPublicPayment(row) {
  return {
    id: row.public_id,
    bookingId: row.booking_id, // internal id, only used server-side; not exposed via API responses directly
    razorpayOrderId: row.razorpay_order_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function create({ bookingId, razorpayOrderId, amount, currency }) {
  const publicId = uuidv4();
  const [result] = await pool.query(
    `INSERT INTO payments (public_id, booking_id, razorpay_order_id, amount, currency, status)
     VALUES (?, ?, ?, ?, ?, 'created')`,
    [publicId, bookingId, razorpayOrderId, amount, currency]
  );
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.query("SELECT * FROM payments WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function findByRazorpayOrderId(razorpayOrderId) {
  const [rows] = await pool.query("SELECT * FROM payments WHERE razorpay_order_id = ? LIMIT 1", [
    razorpayOrderId,
  ]);
  return rows[0] || null;
}

async function findLatestForBooking(bookingId) {
  const [rows] = await pool.query(
    "SELECT * FROM payments WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
    [bookingId]
  );
  return rows[0] || null;
}

/**
 * Atomically transitions a payment to 'paid' and returns whether THIS
 * call was the one that did it. Razorpay's own documented best practice
 * is to run BOTH the client-side verify call AND the server-to-server
 * webhook — meaning they can genuinely race each other in production,
 * not just in theory. The old version of this function (a plain UPDATE
 * with no WHERE-status guard, called only after a separate SELECT
 * checked `status === 'paid'`) had exactly the check-then-act race
 * already fixed elsewhere in this codebase for auth tokens and
 * reminders: both the verify call and the webhook could pass the SELECT
 * before either write landed, and both would mark paid, send a
 * confirmation email, and update the booking — twice.
 */
async function claimAsPaid(id, { razorpayPaymentId, razorpaySignature }) {
  const [result] = await pool.query(
    `UPDATE payments SET status = 'paid', razorpay_payment_id = ?, razorpay_signature = ?
     WHERE id = ? AND status != 'paid'`,
    [razorpayPaymentId, razorpaySignature || null, id]
  );
  return result.affectedRows === 1;
}

async function markFailed(id) {
  await pool.query("UPDATE payments SET status = 'failed' WHERE id = ?", [id]);
}

async function markRefunded(id) {
  await pool.query("UPDATE payments SET status = 'refunded' WHERE id = ?", [id]);
}

module.exports = {
  toPublicPayment,
  create,
  findById,
  findByRazorpayOrderId,
  findLatestForBooking,
  claimAsPaid,
  markFailed,
  markRefunded,
};
