const scheduleService = require("./schedule.service");
const asyncHandler = require("../../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const schedules = await scheduleService.listSchedules(req.dbUser.id);
  res.json({ success: true, data: { schedules } });
});

const getOne = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.getSchedule(req.params.id, req.dbUser.id);
  res.json({ success: true, data: { schedule } });
});

const create = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.createSchedule(req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { schedule } });
});

const update = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.updateSchedule(req.params.id, req.dbUser.id, req.body);
  res.json({ success: true, data: { schedule } });
});

const remove = asyncHandler(async (req, res) => {
  await scheduleService.deleteSchedule(req.params.id, req.dbUser.id);
  res.json({ success: true, message: "Schedule deleted." });
});

const addOverride = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.addOverride(req.params.id, req.dbUser.id, req.body);
  res.status(201).json({ success: true, data: { schedule } });
});

const deleteOverride = asyncHandler(async (req, res) => {
  const schedule = await scheduleService.deleteOverride(
    req.params.id,
    req.params.overrideId,
    req.dbUser.id
  );
  res.json({ success: true, data: { schedule } });
});

module.exports = { list, getOne, create, update, remove, addOverride, deleteOverride };
