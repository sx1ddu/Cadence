const analyticsService = require("./analytics.service");
const asyncHandler = require("../../utils/asyncHandler");

const getDashboard = asyncHandler(async (req, res) => {
  const summary = await analyticsService.getDashboardSummary(req.dbUser.id);
  res.json({ success: true, data: summary });
});

const getOverview = asyncHandler(async (req, res) => {
  const overview = await analyticsService.getOverview(req.dbUser.id);
  res.json({ success: true, data: overview });
});

const getByEventType = asyncHandler(async (req, res) => {
  const data = await analyticsService.getBookingsByEventType(req.dbUser.id);
  res.json({ success: true, data: { eventTypes: data } });
});

const getOverTime = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const data = await analyticsService.getBookingsOverTime(req.dbUser.id, days);
  res.json({ success: true, data: { series: data } });
});

const getTeamStats = asyncHandler(async (req, res) => {
  const stats = await analyticsService.getTeamStats(req.params.teamId, req.dbUser.id);
  res.json({ success: true, data: stats });
});

module.exports = { getDashboard, getOverview, getByEventType, getOverTime, getTeamStats };
