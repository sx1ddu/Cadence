const express = require("express");
const validate = require("../../middleware/validate");
const rateLimit = require("../../middleware/rateLimit");
const teamController = require("./team.controller");
const eventTypeController = require("../event-types/eventType.controller");
const teamAvailabilityController = require("./teamAvailability.controller");
const { slotsQuerySchema } = require("../availability/availability.validation");

const router = express.Router();

// GET /api/team-pages/:slug                               -> team public profile
// GET /api/team-pages/:slug/event-types                    -> active team event types
// GET /api/team-pages/:slug/event-types/:eventSlug          -> one event type's public details
// GET /api/team-pages/:slug/event-types/:eventSlug/slots    -> bookable slots (round-robin/collective aware)
router.get("/:slug", teamController.getPublicProfile);
router.get("/:slug/event-types", eventTypeController.listPublicForTeam);
router.get("/:slug/event-types/:eventSlug", eventTypeController.getPublicForTeam);
router.get(
  "/:slug/event-types/:eventSlug/slots",
  rateLimit({ keyPrefix: "team-slots", windowSec: 60, max: 60 }),
  validate(slotsQuerySchema, "query"),
  teamAvailabilityController.getSlots
);

module.exports = router;
