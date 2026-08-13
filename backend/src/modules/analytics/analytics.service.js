const ApiError = require("../../utils/ApiError");
const analyticsRepo = require("./analytics.repository");
const bookingRepo = require("../bookings/booking.repository");
const eventTypeRepo = require("../event-types/eventType.repository");
const teamRepo = require("../teams/team.repository");

async function getOverview(hostUserId) {
  const [byStatus, upcomingCount] = await Promise.all([
    analyticsRepo.getBookingCountsByStatus(hostUserId),
    analyticsRepo.getUpcomingBookingsCount(hostUserId),
  ]);
  const totalBookings = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  return { totalBookings, upcomingBookings: upcomingCount, byStatus };
}

async function getBookingsByEventType(hostUserId) {
  return analyticsRepo.getBookingCountsByEventType(hostUserId);
}

async function getBookingsOverTime(hostUserId, days) {
  return analyticsRepo.getBookingsOverTime(hostUserId, days);
}

async function getTeamStats(teamPublicId, userId) {
  const team = await teamRepo.findByPublicId(teamPublicId);
  if (!team) throw ApiError.notFound("Team not found.");
  const membership = await teamRepo.findMembership(team.id, userId);
  if (!membership) throw ApiError.forbidden("You're not a member of this team.");

  return analyticsRepo.getTeamBookingStats(team.id);
}

/**
 * A single "give me everything the dashboard's home page needs" endpoint
 * — combines a few sources that would otherwise be 3-4 separate requests
 * from a frontend. Kept intentionally simple (no config, no widgets
 * system) — see the requirements note about not building a full
 * analytics platform.
 */
async function getDashboardSummary(hostUserId) {
  const [overview, recentBookings, eventTypes] = await Promise.all([
    getOverview(hostUserId),
    bookingRepo.listForHost(hostUserId, {}),
    eventTypeRepo.listForUser(hostUserId),
  ]);

  const sortedRecent = recentBookings
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map(bookingRepo.toPublicBooking);

  const upcoming = recentBookings
    .filter((b) => b.status === "confirmed" && new Date(b.start_time) > new Date())
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5)
    .map(bookingRepo.toPublicBooking);

  return {
    overview,
    recentBookings: sortedRecent,
    upcomingBookings: upcoming,
    eventTypeCount: eventTypes.length,
  };
}

module.exports = { getOverview, getBookingsByEventType, getBookingsOverTime, getTeamStats, getDashboardSummary };
