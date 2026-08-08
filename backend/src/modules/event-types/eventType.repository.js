const { v4: uuidv4 } = require("uuid");
const { pool, withTransaction } = require("../../config/db");
const { parseJsonColumn } = require("../../utils/json");

/** Full shape returned to the event type's OWNER (includes booking limits, price, etc). */
function toOwnerView(row, hosts = []) {
  return {
    id: row.public_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    durationMinutes: row.duration_minutes,
    scheduleId: row.schedule_public_id || null,
    teamId: row.team_public_id || null,
    schedulingType: row.scheduling_type || null,
    hosts: hosts.map((h) => ({ userId: h.public_id, name: h.name, priority: h.priority })),
    seatsPerSlot: row.seats_per_slot,
    locations: parseJsonColumn(row.locations),
    bookingQuestions: parseJsonColumn(row.booking_questions),
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    minimumNoticeMinutes: row.minimum_notice_minutes,
    slotIntervalMinutes: row.slot_interval_minutes,
    futureBookingDays: row.future_booking_days,
    bookingLimitCount: row.booking_limit_count,
    bookingLimitWindow: row.booking_limit_window,
    requiresConfirmation: Boolean(row.requires_confirmation),
    isActive: Boolean(row.is_active),
    priceAmount: row.price_amount,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Trimmed shape shown to the public on a booking page — no internal limits/ownership info. */
function toPublicView(row) {
  return {
    id: row.public_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    durationMinutes: row.duration_minutes,
    schedulingType: row.scheduling_type || null,
    seatsPerSlot: row.seats_per_slot,
    locations: parseJsonColumn(row.locations),
    bookingQuestions: parseJsonColumn(row.booking_questions),
    priceAmount: row.price_amount,
    currency: row.currency,
    requiresConfirmation: Boolean(row.requires_confirmation),
  };
}

const SELECT_WITH_SCHEDULE = `
  SELECT et.*, s.public_id AS schedule_public_id, tm.public_id AS team_public_id
  FROM event_types et
  LEFT JOIN schedules s ON s.id = et.schedule_id
  LEFT JOIN teams tm ON tm.id = et.team_id
`;

async function findByPublicId(publicId) {
  const [rows] = await pool.query(`${SELECT_WITH_SCHEDULE} WHERE et.public_id = ? LIMIT 1`, [publicId]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(`${SELECT_WITH_SCHEDULE} WHERE et.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findBySlugForUser(userId, slug) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE} WHERE et.user_id = ? AND et.slug = ? LIMIT 1`,
    [userId, slug]
  );
  return rows[0] || null;
}

async function listForUser(userId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE} WHERE et.user_id = ? ORDER BY et.created_at ASC`,
    [userId]
  );
  return rows;
}

/** Active event types for a user's PUBLIC booking page. */
async function listActiveForUsername(username) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE}
     JOIN users u ON u.id = et.user_id
     WHERE u.username = ? AND et.is_active = 1
     ORDER BY et.created_at ASC`,
    [username]
  );
  return rows;
}

async function findActiveBySlugForUsername(username, slug) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE}
     JOIN users u ON u.id = et.user_id
     WHERE u.username = ? AND et.slug = ? AND et.is_active = 1
     LIMIT 1`,
    [username, slug]
  );
  return rows[0] || null;
}

async function listForTeam(teamId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE} WHERE et.team_id = ? ORDER BY et.created_at ASC`,
    [teamId]
  );
  return rows;
}

async function findBySlugForTeam(teamId, slug) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE} WHERE et.team_id = ? AND et.slug = ? LIMIT 1`,
    [teamId, slug]
  );
  return rows[0] || null;
}

async function listActiveForTeamSlug(teamSlug) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE}
     WHERE et.team_id = (SELECT id FROM teams WHERE slug = ?) AND et.is_active = 1
     ORDER BY et.created_at ASC`,
    [teamSlug]
  );
  return rows;
}

async function findActiveBySlugForTeamSlug(teamSlug, slug) {
  const [rows] = await pool.query(
    `${SELECT_WITH_SCHEDULE}
     WHERE et.team_id = (SELECT id FROM teams WHERE slug = ?) AND et.slug = ? AND et.is_active = 1
     LIMIT 1`,
    [teamSlug, slug]
  );
  return rows[0] || null;
}

// ─── Event type hosts (team event types only) ──────────────────

async function getHosts(eventTypeId) {
  const [rows] = await pool.query(
    `SELECT u.public_id, u.id AS internal_id, u.name, u.email, u.timezone, eth.priority
     FROM event_type_hosts eth
     JOIN users u ON u.id = eth.user_id
     WHERE eth.event_type_id = ?
     ORDER BY eth.priority DESC, u.id ASC`,
    [eventTypeId]
  );
  return rows;
}

/** Replaces the full host list for an event type — delete + re-insert, same pattern as schedule rules. */
async function setHosts(eventTypeId, hosts) {
  return withTransaction(async (conn) => {
    await conn.query("DELETE FROM event_type_hosts WHERE event_type_id = ?", [eventTypeId]);
    for (const host of hosts) {
      await conn.query(
        "INSERT INTO event_type_hosts (event_type_id, user_id, priority) VALUES (?, ?, ?)",
        [eventTypeId, host.userId, host.priority || 0]
      );
    }
  });
}

async function create(userId, data) {
  const publicId = uuidv4();
  const [result] = await pool.query(
    `INSERT INTO event_types (
       public_id, user_id, team_id, scheduling_type, schedule_id, title, slug, description,
       duration_minutes, locations, booking_questions, buffer_before_minutes, buffer_after_minutes,
       minimum_notice_minutes, slot_interval_minutes, future_booking_days,
       booking_limit_count, booking_limit_window, seats_per_slot, requires_confirmation, is_active,
       price_amount, currency
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId,
      userId,
      data.teamInternalId || null,
      data.schedulingType || null,
      data.scheduleInternalId || null,
      data.title,
      data.slug,
      data.description || null,
      data.durationMinutes,
      JSON.stringify(data.locations),
      JSON.stringify(data.bookingQuestions),
      data.bufferBeforeMinutes,
      data.bufferAfterMinutes,
      data.minimumNoticeMinutes,
      data.slotIntervalMinutes || null,
      data.futureBookingDays,
      data.bookingLimitCount || null,
      data.bookingLimitWindow || null,
      data.seatsPerSlot || null,
      data.requiresConfirmation ? 1 : 0,
      data.isActive ? 1 : 0,
      data.priceAmount || null,
      data.currency || null,
    ]
  );
  return findById(result.insertId);
}

const COLUMN_MAP = {
  title: "title",
  slug: "slug",
  description: "description",
  durationMinutes: "duration_minutes",
  bufferBeforeMinutes: "buffer_before_minutes",
  bufferAfterMinutes: "buffer_after_minutes",
  minimumNoticeMinutes: "minimum_notice_minutes",
  slotIntervalMinutes: "slot_interval_minutes",
  futureBookingDays: "future_booking_days",
  bookingLimitCount: "booking_limit_count",
  bookingLimitWindow: "booking_limit_window",
  seatsPerSlot: "seats_per_slot",
  schedulingType: "scheduling_type",
  requiresConfirmation: "requires_confirmation",
  isActive: "is_active",
  priceAmount: "price_amount",
  currency: "currency",
};
const JSON_COLUMN_MAP = { locations: "locations", bookingQuestions: "booking_questions" };
const BOOLEAN_COLUMNS = new Set(["requiresConfirmation", "isActive"]);

async function update(id, data) {
  const fields = [];
  const values = [];

  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (data[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(BOOLEAN_COLUMNS.has(key) ? (data[key] ? 1 : 0) : data[key]);
  }
  for (const [key, column] of Object.entries(JSON_COLUMN_MAP)) {
    if (data[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(JSON.stringify(data[key]));
  }
  if (data.scheduleInternalId !== undefined) {
    fields.push("schedule_id = ?");
    values.push(data.scheduleInternalId);
  }

  if (fields.length === 0) return findById(id);

  values.push(id);
  await pool.query(`UPDATE event_types SET ${fields.join(", ")} WHERE id = ?`, values);
  return findById(id);
}

async function remove(id) {
  await pool.query("DELETE FROM event_types WHERE id = ?", [id]);
}

module.exports = {
  toOwnerView,
  toPublicView,
  findByPublicId,
  findById,
  findBySlugForUser,
  listForUser,
  listActiveForUsername,
  findActiveBySlugForUsername,
  listForTeam,
  findBySlugForTeam,
  listActiveForTeamSlug,
  findActiveBySlugForTeamSlug,
  getHosts,
  setHosts,
  create,
  update,
  remove,
};
