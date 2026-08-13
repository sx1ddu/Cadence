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

// Event type buffers are capped at 240 minutes (see eventType.validation.js).
// The SQL filter below is widened by this much on each side so a booking
// whose UNPADDED time falls just outside [rangeStart, rangeEnd) — but
// whose PADDED (buffered) time overlaps it — still gets fetched. The
// precise overlap check happens in JS after padding.
const MAX_BUFFER_MINUTES = 240;

/**
 * The core conflict-detection query: every ACTIVE (pending or confirmed)
 * booking for this host that overlaps [rangeStart, rangeEnd), where each
 * booking's blocked time is padded by ITS OWN event type's
 * buffer_before_minutes/buffer_after_minutes — a meeting that wants a
 * 15-minute buffer after it actually blocks that 15 minutes from being
 * booked by anything else, not just the meeting's own start/end.
 *
 * Used both by the availability engine (to subtract busy time from free
 * time) and directly by booking creation (as a last-moment
 * race-condition check).
 */
async function getBusyRangesForHost(hostUserId, rangeStart, rangeEnd, excludeEventTypeId) {
  let sql = `SELECT b.start_time, b.end_time, et.buffer_before_minutes, et.buffer_after_minutes
     FROM bookings b
     JOIN event_types et ON et.id = b.event_type_id
     WHERE b.host_user_id = ?
       AND b.status IN ('pending', 'confirmed')
       AND b.start_time < DATE_ADD(?, INTERVAL ? MINUTE)
       AND b.end_time > DATE_SUB(?, INTERVAL ? MINUTE)`;
  const params = [hostUserId, rangeEnd, MAX_BUFFER_MINUTES, rangeStart, MAX_BUFFER_MINUTES];

  // Used for seats-based group events: a group event's OWN prior bookings
  // at the same recurring slot must NOT count as "busy" against itself,
  // or the slot would become unbookable the moment it has one attendee.
  // The host's bookings for every OTHER event type still count normally.
  if (excludeEventTypeId) {
    sql += " AND b.event_type_id != ?";
    params.push(excludeEventTypeId);
  }

  sql += " ORDER BY b.start_time ASC";
  const [rows] = await pool.query(sql, params);
  return padAndFilterBusyRows(rows, rangeStart, rangeEnd);
}

/**
 * Same idea as getBusyRangesForHost, but for a SINGLE user across every
 * booking they're a host on — including collective team bookings where
 * they're one of several hosts (via booking_hosts), not just bookings
 * where they're the primary host_user_id. This is what the availability
 * engine uses for team event types, since a team member's busy time
 * includes their personal bookings too. Also buffer-aware, same as above.
 */
async function getBusyRangesForUser(userId, rangeStart, rangeEnd) {
  const [rows] = await pool.query(
    `SELECT DISTINCT b.start_time, b.end_time, et.buffer_before_minutes, et.buffer_after_minutes
     FROM booking_hosts bh
     JOIN bookings b ON b.id = bh.booking_id
     JOIN event_types et ON et.id = b.event_type_id
     WHERE bh.user_id = ?
       AND b.status IN ('pending', 'confirmed')
       AND b.start_time < DATE_ADD(?, INTERVAL ? MINUTE)
       AND b.end_time > DATE_SUB(?, INTERVAL ? MINUTE)
     ORDER BY b.start_time ASC`,
    [userId, rangeEnd, MAX_BUFFER_MINUTES, rangeStart, MAX_BUFFER_MINUTES]
  );
  return padAndFilterBusyRows(rows, rangeStart, rangeEnd);
}

/**
 * Pads each fetched booking's [start_time, end_time) by its own event
 * type's buffer minutes, then keeps only the rows whose PADDED range
 * actually overlaps [rangeStart, rangeEnd) — the SQL query above is
 * intentionally wider than this to avoid missing edge cases, so this
 * final precise filter is what the caller actually gets back.
 */
function padAndFilterBusyRows(rows, rangeStart, rangeEnd) {
  const result = [];
  for (const row of rows) {
    const start = new Date(row.start_time.getTime() - row.buffer_before_minutes * 60 * 1000);
    const end = new Date(row.end_time.getTime() + row.buffer_after_minutes * 60 * 1000);
    if (start < rangeEnd && end > rangeStart) {
      result.push({ start, end });
    }
  }
  return result.sort((a, b) => a.start - b.start);
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
 * Same query as countActiveBookingsForEventTypeInWindow, but run with
 * FOR UPDATE inside the booking-creation transaction as the authoritative
 * check. The plain (non-locking) version above is used earlier as a fast
 * pre-check so an obviously-over-the-limit request fails quickly without
 * doing the work of resolving hosts/opening a transaction — but a plain
 * COUNT before the transaction has the same race as the old token checks
 * did: two concurrent bookings for the last remaining slot in a
 * "3 per day" limit could both read count=2 and both insert, landing at
 * 4. This locked recount, immediately before the INSERT in the same
 * transaction, is what actually enforces the limit under concurrency.
 */
async function countActiveBookingsForEventTypeInWindowForUpdate(conn, eventTypeId, windowStart, windowEnd) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE event_type_id = ? AND status IN ('pending', 'confirmed')
       AND start_time >= ? AND start_time < ?
     FOR UPDATE`,
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
 * InnoDB takes gap locks over the range it scans to evaluate the WHERE
 * clause, which blocks a concurrent transaction from inserting a new
 * overlapping row until this transaction commits or rolls back — even
 * though there's "nothing to lock" yet if no row currently overlaps.
 * This is what stops two people who click "Book" on the same slot at the
 * same instant from both succeeding.
 *
 * Locking-breadth note: because the buffer comparison wraps start_time/
 * end_time in DATE_SUB/DATE_ADD, MySQL can't push those bounds into the
 * index the way it could with a plain `start_time < ?` comparison — it
 * can still use host_user_id (and status) to narrow the scan, but the
 * gap lock ends up covering that host's whole matching-status range
 * rather than a tight window around the requested time. That's strictly
 * SAFER (it can only prevent more races, never fewer) at the cost of
 * serializing a single host's own concurrent booking attempts slightly
 * more than the bare minimum necessary — an acceptable trade for
 * correctness over raw throughput at this project's scale.
 *
 * Buffer-aware on BOTH sides: an existing booking's padded footprint
 * (its own buffer_before/buffer_after) is compared against the
 * CANDIDATE's padded footprint (candidateEventType's own buffers) — two
 * meetings conflict if their padded footprints overlap, even if their
 * raw start/end times don't.
 *
 * `exclude` is only used for seats-based group events: it excludes rows
 * belonging to the SAME event type at the SAME exact start time from the
 * conflict count, since those are legitimate additional attendees on the
 * same slot, not a double-booking.
 */
async function hasOverlapForUpdate(conn, hostUserId, startTime, endTime, candidateEventType, exclude = {}) {
  const candidateStart = new Date(startTime.getTime() - candidateEventType.buffer_before_minutes * 60000);
  const candidateEnd = new Date(endTime.getTime() + candidateEventType.buffer_after_minutes * 60000);

  let sql = `SELECT b.id FROM bookings b
     JOIN event_types bet ON bet.id = b.event_type_id
     WHERE b.host_user_id = ?
       AND b.status IN ('pending', 'confirmed')
       AND DATE_SUB(b.start_time, INTERVAL bet.buffer_before_minutes MINUTE) < ?
       AND DATE_ADD(b.end_time, INTERVAL bet.buffer_after_minutes MINUTE) > ?`;
  const params = [hostUserId, candidateEnd, candidateStart];

  if (exclude.eventTypeId && exclude.startTime) {
    sql += " AND NOT (b.event_type_id = ? AND b.start_time = ?)";
    params.push(exclude.eventTypeId, exclude.startTime);
  }

  sql += " FOR UPDATE";
  const [rows] = await conn.query(sql, params);
  return rows.length > 0;
}

/** Same as hasOverlapForUpdate, but true if ANY of several users (collective event hosts) has a conflict. Also buffer-aware on both sides. */
async function hasAnyHostOverlapForUpdate(conn, userIds, startTime, endTime, candidateEventType) {
  const candidateStart = new Date(startTime.getTime() - candidateEventType.buffer_before_minutes * 60000);
  const candidateEnd = new Date(endTime.getTime() + candidateEventType.buffer_after_minutes * 60000);

  const [rows] = await conn.query(
    `SELECT bh.id FROM booking_hosts bh
     JOIN bookings b ON b.id = bh.booking_id
     JOIN event_types bet ON bet.id = b.event_type_id
     WHERE bh.user_id IN (?)
       AND b.status IN ('pending', 'confirmed')
       AND DATE_SUB(b.start_time, INTERVAL bet.buffer_before_minutes MINUTE) < ?
       AND DATE_ADD(b.end_time, INTERVAL bet.buffer_after_minutes MINUTE) > ?
     FOR UPDATE`,
    [userIds, candidateEnd, candidateStart]
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
 * Updates ONLY payment_status, leaving booking status untouched — used by
 * the payments module, since a booking's lifecycle status (pending/
 * confirmed/cancelled/rejected) and its payment status are orthogonal:
 * a booking can require host confirmation AND payment independently, and
 * paying doesn't automatically confirm it (see payment.service.js).
 */
async function updatePaymentStatus(id, paymentStatus) {
  await pool.query("UPDATE bookings SET payment_status = ? WHERE id = ?", [paymentStatus, id]);
  return findById(id);
}

async function setGoogleCalendarEventId(id, googleEventId) {
  await pool.query("UPDATE bookings SET google_calendar_event_id = ? WHERE id = ?", [googleEventId, id]);
}

/**
 * Backup sweep query for the reminder cron job (see jobs/cron/reminderSweep.js):
 * confirmed bookings starting soon that haven't had a reminder sent yet.
 * This exists ALONGSIDE the primary mechanism (a BullMQ delayed job
 * scheduled at booking-confirmation time — see booking.service.js's
 * scheduleReminderForBooking) as a safety net for bookings that might
 * have missed that path (e.g. the worker was down at confirmation time).
 */
async function findBookingsNeedingReminderSweep(windowMinutes) {
  const [rows] = await pool.query(
    `SELECT * FROM bookings
     WHERE status = 'confirmed'
       AND reminder_sent_at IS NULL
       AND start_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? MINUTE)`,
    [windowMinutes]
  );
  return rows;
}

async function markReminderSent(id) {
  await pool.query("UPDATE bookings SET reminder_sent_at = NOW() WHERE id = ?", [id]);
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

/**
 * True if `userId` is one of the (possibly several) hosts recorded on
 * this booking via booking_hosts — used for authorization on collective
 * bookings, where any assigned host should be able to manage the
 * booking, not just whichever one happens to be stored as the "primary"
 * host_user_id (see the booking_hosts migration for why both exist).
 */
async function isUserHostOnBooking(bookingId, userId) {
  const [rows] = await pool.query(
    "SELECT 1 FROM booking_hosts WHERE booking_id = ? AND user_id = ? LIMIT 1",
    [bookingId, userId]
  );
  return rows.length > 0;
}

module.exports = {
  toPublicBooking,
  findByPublicId,
  findById,
  getBusyRangesForHost,
  getBusyRangesForUser,
  countActiveBookingsForEventTypeInWindow,
  countActiveBookingsForEventTypeInWindowForUpdate,
  hasOverlapForUpdate,
  hasAnyHostOverlapForUpdate,
  countActiveBookingsAtExactSlotForUpdate,
  createWithConnection,
  listForHost,
  updateStatus,
  updatePaymentStatus,
  setGoogleCalendarEventId,
  findBookingsNeedingReminderSweep,
  markReminderSent,
  hasBookingsForEventType,
  isUserHostOnBooking,
  getLastBookingTimePerHost,
};
