const eventTypeService = require("./eventType.service");
const asyncHandler = require("../../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const eventTypes = await eventTypeService.listMyEventTypes(req.dbUser.id);
  res.json({ success: true, data: { eventTypes } });
});

const listForTeam = asyncHandler(async (req, res) => {
  const eventTypes = await eventTypeService.listTeamEventTypes(req.params.teamId, req.dbUser.id);
  res.json({ success: true, data: { eventTypes } });
});

const getOne = asyncHandler(async (req, res) => {
  const eventType = await eventTypeService.getMyEventType(req.params.id, req.dbUser.id);
  res.json({ success: true, data: { eventType } });
});

const create = asyncHandler(async (req, res) => {
  const eventType = await eventTypeService.createEventType(req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { eventType } });
});

const update = asyncHandler(async (req, res) => {
  const eventType = await eventTypeService.updateEventType(req.params.id, req.dbUser.id, req.body);
  res.json({ success: true, data: { eventType } });
});

const remove = asyncHandler(async (req, res) => {
  await eventTypeService.deleteEventType(req.params.id, req.dbUser.id);
  res.json({ success: true, message: "Event type deleted." });
});

// Public (unauthenticated) booking-page endpoints
const listPublic = asyncHandler(async (req, res) => {
  const data = await eventTypeService.listPublicEventTypes(req.params.username);
  res.json({ success: true, data });
});

const getPublic = asyncHandler(async (req, res) => {
  const data = await eventTypeService.getPublicEventType(req.params.username, req.params.slug);
  res.json({ success: true, data });
});

const listPublicForTeam = asyncHandler(async (req, res) => {
  const data = await eventTypeService.listPublicTeamEventTypes(req.params.slug);
  res.json({ success: true, data });
});

const getPublicForTeam = asyncHandler(async (req, res) => {
  const data = await eventTypeService.getPublicTeamEventType(req.params.slug, req.params.eventSlug);
  res.json({ success: true, data });
});

module.exports = {
  list,
  listForTeam,
  getOne,
  create,
  update,
  remove,
  listPublic,
  getPublic,
  listPublicForTeam,
  getPublicForTeam,
};
