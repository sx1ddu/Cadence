const { z } = require("zod");

const createOrderSchema = z.object({
  bookingId: z.string().uuid("bookingId must be a valid booking id"),
});

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

module.exports = { createOrderSchema, verifyPaymentSchema };
