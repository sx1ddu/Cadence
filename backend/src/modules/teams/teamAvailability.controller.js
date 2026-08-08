const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const eventTypeRepo = require("../event-types/eventType.repository");
const availabilityService = require("../availability/availability.service");

const getSlots = asyncHandler(async (req, res) => {
  const { slug, eventSlug } = req.params;
  const { from, to, timezone } = req.query;

  const eventType = await eventTypeRepo.findActiveBySlugForTeamSlug(slug, eventSlug);
  if (!eventType) throw ApiError.notFound("Event type not found.");

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);

  const slots = await availabilityService.getAvailableSlots({ eventType, fromDate, toDate, timezone });

  res.json({ success: true, data: { slots } });
});

module.exports = { getSlots };
