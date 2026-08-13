const adminService = require("./admin.service");
const asyncHandler = require("../../utils/asyncHandler");

const getStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getStats();
  res.json({ success: true, data: stats });
});

const listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  res.json({ success: true, data: result });
});

const setUserActive = asyncHandler(async (req, res) => {
  await adminService.setUserActive(req.params.userId, req.body.isActive, req.dbUser.id);
  res.json({ success: true, message: "User status updated." });
});

const setUserRole = asyncHandler(async (req, res) => {
  await adminService.setUserRole(req.params.userId, req.body.role, req.dbUser.id);
  res.json({ success: true, message: "User role updated." });
});

const getBookingsOverview = asyncHandler(async (req, res) => {
  const bookings = await adminService.getBookingsOverview();
  res.json({ success: true, data: { bookings } });
});

const getTeamsOverview = asyncHandler(async (req, res) => {
  const teams = await adminService.getTeamsOverview();
  res.json({ success: true, data: { teams } });
});

module.exports = {
  getStats,
  listUsers,
  setUserActive,
  setUserRole,
  getBookingsOverview,
  getTeamsOverview,
};
