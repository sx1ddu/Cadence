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

async function markPaid(id, { razorpayPaymentId, razorpaySignature }) {
  await pool.query(
    `UPDATE payments SET status = 'paid', razorpay_payment_id = ?, razorpay_signature = ?
     WHERE id = ?`,
    [razorpayPaymentId, razorpaySignature || null, id]
  );
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
  markPaid,
  markFailed,
  markRefunded,
};
