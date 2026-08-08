const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/db");
const { parseJsonColumn } = require("../../utils/json");

function toPublicBooking(row) {
  return {
    id: row.public_id,
    title: row.title,
    durationMinutes: row.duration_minutes,
    startTime: row.start_time,
    endTime: row.end_time,
    attendeeName: row.attendee_name,
    attendeeEmail: row.attendee_email,
    attendeeTimezone: row.attendee_timezone,
    answers: parseJsonColumn(row.answers),
    location: parseJsonColumn(row.location),
    status: row.status,
    cancellationReason: row.cancellation_reason,
    priceAmount: row.price_amount,
    currency: row.currency,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
  };
}

async function findByPublicId(publicId) {
  const [rows] = await pool.query("SELECT * FROM bookings WHERE public_id = ? LIMIT 1", [publicId]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query("SELECT * FROM bookings WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

/**
 * The core conflict-detection query: every ACTIVE (pending or confirmed)
 * booking for this host that overlaps [rangeStart, rangeEnd). Used both
 * by the availability engine (to subtract busy time from free time) and
 * directly by booking creation (as a last-moment race-condition check).
 *
 * Two ranges overlap iff each one starts before the other ends.
 */
async function getBusyRangesForHost(hostUserId, rangeStart, rangeEnd, excludeEventTypeId) {
  let sql = `SELECT start_time, end_time FROM bookings
     WHERE host_user_id = ?
       AND status IN ('pending', 'confirmed')
       AND start_time < ?
       AND end_time > ?`;
  const params = [hostUserId, rangeEnd, rangeStart];

  // Used for seats-based group events: a group event's OWN prior bookings
  // at the same recurring slot must NOT count as "busy" against itself,
  // or the slot would become unbookable the moment it has one attendee.
  // The host's bookings for every OTHER event type still count normally.
  if (excludeEventTypeId) {
    sql += " AND event_type_id != ?";
    params.push(excludeEventTypeId);
  }

  sql += " ORDER BY start_time ASC";
  const [rows] = await pool.query(sql, params);
  return rows.map((r) => ({ start: r.start_time, end: r.end_time }));
}

/**
 * Same idea as getBusyRangesForHost, but for a SINGLE user across every
 * booking they're a host on — including collective team bookings where
 * they're one of several hosts (via booking_hosts), not just bookings
 * where they're the primary host_user_id. This is what the availability
 * engine uses for team event types, since a team member's busy time
 * includes their personal bookings too.
 */
async function getBusyRangesForUser(userId, rangeStart, rangeEnd) {
  const [rows] = await pool.query(
    `SELECT DISTINCT b.start_time, b.end_time
     FROM booking_hosts bh
     JOIN bookings b ON b.id = bh.booking_id
     WHERE bh.user_id = ?
       AND b.status IN ('pending', 'confirmed')
       AND b.start_time < ?
       AND b.end_time > ?
     ORDER BY b.start_time ASC`,
    [userId, rangeEnd, rangeStart]
  );
  return rows.map((r) => ({ start: r.start_time, end: r.end_time }));
}

async function countActiveBookingsForEventTypeInWindow(eventTypeId, windowStart, windowEnd) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE event_type_id = ? AND status IN ('pending', 'confirmed')
       AND start_time >= ? AND start_time < ?`,
    [eventTypeId, windowStart, windowEnd]
  );
  return rows[0].count;
}

/**
 * Transaction-aware variants of the conflict check + insert, used together
 * by booking.service so both run inside the SAME transaction/connection.
 *
 * Why this prevents double-booking under concurrency: this query is
 * `SELECT ... FOR UPDATE` against an indexed range (the
 * idx_bookings_host_conflict index covers host_user_id, status,
 * start_time, end_time). Under MySQL's default REPEATABLE READ isolation,
 * InnoDB takes gap locks across that index range, which blocks a
 * concurrent transaction from inserting a new overlapping row until this
 * transaction commits or rolls back — even though there's "nothing to
 * lock" yet if no row currently overlaps. This is what stops two people
 * who click "Book" on the same slot at the same instant from both
 * succeeding.
 *
 * `exclude` is only used for seats-based group events: it excludes rows
 * belonging to the SAME event type at the SAME exact start time from the
 * conflict count, since those are legitimate additional attendees on the
 * same slot, not a double-booking.
 */
async function hasOverlapForUpdate(conn, hostUserId, startTime, endTime, exclude = {}) {
  let sql = `SELECT id FROM bookings
     WHERE host_user_id = ?
       AND status IN ('pending', 'confirmed')
       AND start_time < ?
       AND end_time > ?`;
  const params = [hostUserId, endTime, startTime];

  if (exclude.eventTypeId && exclude.startTime) {
    sql += " AND NOT (event_type_id = ? AND start_time = ?)";
    params.push(exclude.eventTypeId, exclude.startTime);
  }

  sql += " FOR UPDATE";
  const [rows] = await conn.query(sql, params);
  return rows.length > 0;
}

/** Same as hasOverlapForUpdate, but true if ANY of several users (collective event hosts) has a conflict. */
async function hasAnyHostOverlapForUpdate(conn, userIds, startTime, endTime) {
  const [rows] = await conn.query(
    `SELECT bh.id FROM booking_hosts bh
     JOIN bookings b ON b.id = bh.booking_id
     WHERE bh.user_id IN (?)
       AND b.status IN ('pending', 'confirmed')
       AND b.start_time < ?
       AND b.end_time > ?
     FOR UPDATE`,
    [userIds, endTime, startTime]
  );
  return rows.length > 0;
}

/** Locks and counts active bookings for a group event's exact slot — the seat-capacity check. */
async function countActiveBookingsAtExactSlotForUpdate(conn, eventTypeId, startTime) {
  const [rows] = await conn.query(
    `SELECT id FROM bookings
     WHERE event_type_id = ? AND start_time = ? AND status IN ('pending', 'confirmed')
     FOR UPDATE`,
    [eventTypeId, startTime]
  );
  return rows.length;
}

async function insertBookingHosts(conn, bookingId, userIds) {
  for (const userId of userIds) {
    await conn.query("INSERT INTO booking_hosts (booking_id, user_id) VALUES (?, ?)", [
      bookingId,
      userId,
    ]);
  }
}

async function createWithConnection(conn, data) {
  const publicId = uuidv4();
  const [result] = await conn.query(
    `INSERT INTO bookings (
       public_id, event_type_id, host_user_id, title, duration_minutes,
       start_time, end_time, attendee_name, attendee_email, attendee_timezone,
       answers, location, status, price_amount, currency, payment_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId,
      data.eventTypeId,
      data.hostUserId,
      data.title,
      data.durationMinutes,
      data.startTime,
      data.endTime,
      data.attendeeName,
      data.attendeeEmail,
      data.attendeeTimezone,
      JSON.stringify(data.answers),
      JSON.stringify(data.location),
      data.status,
      data.priceAmount || null,
      data.currency || null,
      data.paymentStatus,
    ]
  );

  // Every booking records its full set of hosts in booking_hosts — one row
  // for a personal or round-robin booking, one row per host for a
  // collective booking. This is what conflict-checking and the
  // availability engine query against for team members (see
  // getBusyRangesForUser above).
  const hostUserIds = data.allHostUserIds && data.allHostUserIds.length > 0
    ? data.allHostUserIds
    : [data.hostUserId];
  await insertBookingHosts(conn, result.insertId, hostUserIds);

  const [rows] = await conn.query("SELECT * FROM bookings WHERE id = ?", [result.insertId]);
  return rows[0];
}

async function listForHost(hostUserId, { status, from, to } = {}) {
  const conditions = ["host_user_id = ?"];
  const values = [hostUserId];

  if (status) {
    conditions.push("status = ?");
    values.push(status);
  }
  if (from) {
    conditions.push("start_time >= ?");
    values.push(from);
  }
  if (to) {
    conditions.push("start_time < ?");
    values.push(to);
  }

  const [rows] = await pool.query(
    `SELECT * FROM bookings WHERE ${conditions.join(" AND ")} ORDER BY start_time ASC`,
    values
  );
  return rows;
}

async function updateStatus(id, status, extra = {}) {
  const fields = ["status = ?"];
  const values = [status];

  if (extra.cancellationReason !== undefined) {
    fields.push("cancellation_reason = ?");
    values.push(extra.cancellationReason);
  }
  if (extra.cancelledBy !== undefined) {
    fields.push("cancelled_by = ?");
    values.push(extra.cancelledBy);
  }
  if (extra.paymentStatus !== undefined) {
    fields.push("payment_status = ?");
    values.push(extra.paymentStatus);
  }

  values.push(id);
  await pool.query(`UPDATE bookings SET ${fields.join(", ")} WHERE id = ?`, values);
  return findById(id);
}

/**
 * For round-robin fairness: the most recent active booking timestamp for
 * each of the given candidate hosts. A host with no prior bookings (not
 * in the result map) is treated as "longest ago" — i.e. prioritized —
 * by the caller. Not run inside a transaction: a small race here only
 * affects fairness distribution slightly under concurrent load, never
 * correctness (the actual conflict check still runs FOR UPDATE separately).
 */
async function getLastBookingTimePerHost(userIds) {
  const [rows] = await pool.query(
    `SELECT bh.user_id, MAX(b.created_at) AS last_booked_at
     FROM booking_hosts bh
     JOIN bookings b ON b.id = bh.booking_id
     WHERE bh.user_id IN (?) AND b.status IN ('pending', 'confirmed')
     GROUP BY bh.user_id`,
    [userIds]
  );
  return rows;
}

async function hasBookingsForEventType(eventTypeId) {
  const [rows] = await pool.query("SELECT id FROM bookings WHERE event_type_id = ? LIMIT 1", [
    eventTypeId,
  ]);
  return rows.length > 0;
}

module.exports = {
  toPublicBooking,
  findByPublicId,
  findById,
  getBusyRangesForHost,
  getBusyRangesForUser,
  countActiveBookingsForEventTypeInWindow,
  hasOverlapForUpdate,
  hasAnyHostOverlapForUpdate,
  countActiveBookingsAtExactSlotForUpdate,
  createWithConnection,
  listForHost,
  updateStatus,
  hasBookingsForEventType,
  getLastBookingTimePerHost,
};
