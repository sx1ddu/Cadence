const express = require("express");
const validate = require("../../middleware/validate");
const rateLimit = require("../../middleware/rateLimit");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./booking.controller");
const { createBookingSchema, cancelBookingSchema } = require("./booking.validation");

const router = express.Router();

// ─── Public (attendees don't need an account) ──────────────────
router.post(
  "/",
  rateLimit({ keyPrefix: "create-booking", windowSec: 60, max: 10 }),
  validate(createBookingSchema),
  controller.create
);
router.get("/public/:id", controller.getPublic);
router.post("/public/:id/cancel", validate(cancelBookingSchema), controller.cancelPublic);

// ─── Authenticated (host dashboard) ─────────────────────────────
router.get("/", authenticate, controller.listMine);
router.post("/:id/cancel", authenticate, validate(cancelBookingSchema), controller.cancelMine);
router.post("/:id/confirm", authenticate, controller.confirmMine);
router.post("/:id/reject", authenticate, validate(cancelBookingSchema), controller.rejectMine);

module.exports = router;
