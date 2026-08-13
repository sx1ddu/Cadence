const { pool } = require("../../config/db");

/** Booking counts by status for a host, over all time. */
async function getBookingCountsByStatus(hostUserId) {
  const [rows] = await pool.query(
    `SELECT status, COUNT(*) AS count FROM bookings WHERE host_user_id = ? GROUP BY status`,
    [hostUserId]
  );
  const counts = { pending: 0, confirmed: 0, cancelled: 0, rejected: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** Bookings grouped by event type, for a host. */
async function getBookingCountsByEventType(hostUserId) {
  const [rows] = await pool.query(
    `SELECT et.title, et.slug, COUNT(b.id) AS count
     FROM event_types et
     LEFT JOIN bookings b ON b.event_type_id = et.id AND b.status IN ('pending', 'confirmed')
     WHERE et.user_id = ?
     GROUP BY et.id, et.title, et.slug
     ORDER BY count DESC`,
    [hostUserId]
  );
  return rows;
}

/** Daily booking counts for the last N days, for a simple time-series chart. */
async function getBookingsOverTime(hostUserId, days) {
  const [rows] = await pool.query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count
     FROM bookings
     WHERE host_user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [hostUserId, days]
  );
  return rows.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    count: r.count,
  }));
}

async function getUpcomingBookingsCount(hostUserId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE host_user_id = ? AND status = 'confirmed' AND start_time > NOW()`,
    [hostUserId]
  );
  return rows[0].count;
}

/** Aggregate stats for every event type belonging to a team (used for team analytics). */
async function getTeamBookingStats(teamId) {
  const [rows] = await pool.query(
    `SELECT b.status, COUNT(*) AS count
     FROM bookings b
     JOIN event_types et ON et.id = b.event_type_id
     WHERE et.team_id = ?
     GROUP BY b.status`,
    [teamId]
  );
  const counts = { pending: 0, confirmed: 0, cancelled: 0, rejected: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

module.exports = {
  getBookingCountsByStatus,
  getBookingCountsByEventType,
  getBookingsOverTime,
  getUpcomingBookingsCount,
  getTeamBookingStats,
};
