const ApiError = require("../../utils/ApiError");
const adminRepo = require("./admin.repository");
const userRepo = require("../users/user.repository");

async function getStats() {
  return adminRepo.getPlatformStats();
}

async function listUsers(query) {
  const limit = Math.min(Number(query.limit) || 50, 200);
  const offset = Number(query.offset) || 0;
  return adminRepo.listUsers({ limit, offset, search: query.search });
}

async function setUserActive(userPublicId, isActive, requestingAdminId) {
  const user = await userRepo.findByPublicId(userPublicId);
  if (!user) throw ApiError.notFound("User not found.");
  if (user.id === requestingAdminId && !isActive) {
    throw ApiError.badRequest("You can't deactivate your own account.");
  }
  await adminRepo.setUserActive(userPublicId, isActive);
}

async function setUserRole(userPublicId, role, requestingAdminId) {
  const user = await userRepo.findByPublicId(userPublicId);
  if (!user) throw ApiError.notFound("User not found.");
  if (user.id === requestingAdminId && role !== "admin") {
    throw ApiError.badRequest("You can't remove your own admin role.");
  }
  await adminRepo.setUserRole(userPublicId, role);
}

async function getBookingsOverview() {
  return adminRepo.listRecentBookings();
}

async function getTeamsOverview() {
  return adminRepo.listTeamsOverview();
}

module.exports = { getStats, listUsers, setUserActive, setUserRole, getBookingsOverview, getTeamsOverview };
