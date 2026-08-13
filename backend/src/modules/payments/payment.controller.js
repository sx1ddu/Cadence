const ApiError = require("../../utils/ApiError");
const paymentService = require("./payment.service");
const asyncHandler = require("../../utils/asyncHandler");

const createOrder = asyncHandler(async (req, res) => {
  const order = await paymentService.createOrderForBooking(req.body.bookingId);
  res.status(201).json({ success: true, data: order });
});

const verify = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyPayment(req.body);
  res.json({ success: true, data: result });
});

const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  if (!signature) throw ApiError.badRequest("Missing webhook signature header.");
  if (!req.rawBody) throw ApiError.internal("Raw request body wasn't captured for signature verification.");

  await paymentService.handleWebhook(req.rawBody, signature);
  res.json({ success: true });
});

const refund = asyncHandler(async (req, res) => {
  const payment = await paymentService.refundPayment(req.params.bookingId, req.dbUser.id);
  res.json({ success: true, data: { payment } });
});

module.exports = { createOrder, verify, webhook, refund };
