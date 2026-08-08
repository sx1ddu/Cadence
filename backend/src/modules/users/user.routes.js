const express = require("express");
const validate = require("../../middleware/validate");
const rateLimit = require("../../middleware/rateLimit");
const eventTypeController = require("../event-types/eventType.controller");
const availabilityController = require("../availability/availability.controller");
const { slotsQuerySchema } = require("../availability/availability.validation");
const userController = require("./user.controller");

const router = express.Router();

// GET /api/users/:username                        -> public profile for a booking page header
// GET /api/users/:username/event-types             -> that user's active, bookable event types
// GET /api/users/:username/event-types/:slug       -> a single event type's public details
// GET /api/users/:username/event-types/:slug/slots -> bookable time slots for a date range
router.get("/:username", userController.getPublicProfile);
router.get("/:username/event-types", eventTypeController.listPublic);
router.get("/:username/event-types/:slug", eventTypeController.getPublic);
router.get(
  "/:username/event-types/:slug/slots",
  rateLimit({ keyPrefix: "slots", windowSec: 60, max: 60 }),
  validate(slotsQuerySchema, "query"),
  availabilityController.getSlots
);

module.exports = router;
