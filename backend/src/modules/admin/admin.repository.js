const { pool } = require("../../config/db");

async function getPlatformStats() {
  const [[userCount], [bookingCount], [teamCount], [eventTypeCount]] = await Promise.all([
    pool.query("SELECT COUNT(*) AS count FROM users"),
    pool.query("SELECT COUNT(*) AS count FROM bookings"),
    pool.query("SELECT COUNT(*) AS count FROM teams"),
    pool.query("SELECT COUNT(*) AS count FROM event_types"),
  ]);
  const [bookingsByStatus] = await pool.query("SELECT status, COUNT(*) AS count FROM bookings GROUP BY status");

  return {
    totalUsers: userCount[0].count,
    totalBookings: bookingCount[0].count,
    totalTeams: teamCount[0].count,
    totalEventTypes: eventTypeCount[0].count,
    bookingsByStatus,
  };
}

async function listUsers({ limit = 50, offset = 0, search }) {
  const conditions = [];
  const values = [];
  if (search) {
    conditions.push("(name LIKE ? OR email LIKE ? OR username LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT id, public_id, name, username, email, role, is_active, email_verified_at, created_at
     FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );
  const [totalRows] = await pool.query(`SELECT COUNT(*) AS total FROM users ${where}`, values);

  return { users: rows, total: totalRows[0].total };
}

async function setUserActive(userPublicId, isActive) {
  await pool.query("UPDATE users SET is_active = ? WHERE public_id = ?", [isActive ? 1 : 0, userPublicId]);
}

async function setUserRole(userPublicId, role) {
  await pool.query("UPDATE users SET role = ? WHERE public_id = ?", [role, userPublicId]);
}

async function listRecentBookings(limit = 50) {
  const [rows] = await pool.query(
    `SELECT b.public_id, b.title, b.status, b.start_time, b.attendee_name, b.attendee_email,
            u.username AS host_username, u.name AS host_name
     FROM bookings b
     JOIN users u ON u.id = b.host_user_id
     ORDER BY b.created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

async function listTeamsOverview() {
  const [rows] = await pool.query(
    `SELECT t.public_id, t.name, t.slug, t.is_organization, t.created_at,
            COUNT(tm.id) AS member_count
     FROM teams t
     LEFT JOIN team_members tm ON tm.team_id = t.id
     GROUP BY t.id
     ORDER BY t.created_at DESC`
  );
  return rows;
}

module.exports = {
  getPlatformStats,
  listUsers,
  setUserActive,
  setUserRole,
  listRecentBookings,
  listTeamsOverview,
};
