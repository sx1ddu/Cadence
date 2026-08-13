const express = require("express");
const validate = require("../../middleware/validate");
const rateLimit = require("../../middleware/rateLimit");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./payment.controller");
const { createOrderSchema, verifyPaymentSchema } = require("./payment.validation");

const router = express.Router();

// Public — the booking's UUID is the capability token (same trust model as booking cancellation).
router.post(
  "/orders",
  rateLimit({ keyPrefix: "payment-order", windowSec: 60, max: 10 }),
  validate(createOrderSchema),
  controller.createOrder
);
router.post("/verify", validate(verifyPaymentSchema), controller.verify);

// Razorpay server-to-server webhook — signature-verified, not cookie/JWT-authenticated.
// NOTE: this route relies on req.rawBody, captured by the raw-body-preserving
// json() verify hook in app.js — see the comment there for why.
router.post("/webhook", controller.webhook);

// Host-only
router.post("/:bookingId/refund", authenticate, controller.refund);

module.exports = router;
