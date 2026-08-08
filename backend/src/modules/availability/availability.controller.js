const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const eventTypeRepo = require("../event-types/eventType.repository");
const availabilityService = require("./availability.service");

const getSlots = asyncHandler(async (req, res) => {
  const { username, slug } = req.params;
  const { from, to, timezone } = req.query;

  const eventType = await eventTypeRepo.findActiveBySlugForUsername(username, slug);
  if (!eventType) throw ApiError.notFound("Event type not found.");

  // `from`/`to` are calendar dates (YYYY-MM-DD); treat the window as
  // [start of `from` day, start of the day AFTER `to`) in UTC so the
  // whole of `to` is included regardless of the booker's timezone offset.
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);

  const slots = await availabilityService.getAvailableSlots({
    eventType,
    fromDate,
    toDate,
    timezone,
  });

  res.json({ success: true, data: { slots } });
});

module.exports = { getSlots };
