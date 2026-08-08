const { v4: uuidv4 } = require("uuid");
const { pool, withTransaction } = require("../../config/db");
const { parseJsonColumn } = require("../../utils/json");

function toPublicRule(row) {
  return {
    id: row.id,
    days: parseJsonColumn(row.days),
    startTime: row.start_time.slice(0, 5), // "09:00:00" -> "09:00"
    endTime: row.end_time.slice(0, 5),
  };
}

function toPublicOverride(row) {
  return {
    id: row.id,
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date,
    isUnavailable: Boolean(row.is_unavailable),
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
  };
}

function toPublicSchedule(row, rules = [], overrides = []) {
  return {
    id: row.public_id,
    name: row.name,
    timezone: row.timezone,
    isDefault: Boolean(row.is_default),
    rules: rules.map(toPublicRule),
    overrides: overrides.map(toPublicOverride),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findByPublicId(publicId) {
  const [rows] = await pool.query("SELECT * FROM schedules WHERE public_id = ? LIMIT 1", [publicId]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query("SELECT * FROM schedules WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function listForUser(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM schedules WHERE user_id = ? ORDER BY is_default DESC, created_at ASC",
    [userId]
  );
  return rows;
}

async function findDefaultForUser(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM schedules WHERE user_id = ? AND is_default = 1 LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function getRules(scheduleId) {
  const [rows] = await pool.query(
    "SELECT * FROM availability_rules WHERE schedule_id = ? ORDER BY id ASC",
    [scheduleId]
  );
  return rows;
}

async function getOverrides(scheduleId) {
  const [rows] = await pool.query(
    "SELECT * FROM schedule_overrides WHERE schedule_id = ? ORDER BY date ASC",
    [scheduleId]
  );
  return rows;
}

async function getScheduleWithDetails(scheduleId) {
  const schedule = await findById(scheduleId);
  if (!schedule) return null;
  const [rules, overrides] = await Promise.all([getRules(scheduleId), getOverrides(scheduleId)]);
  return { schedule, rules, overrides };
}

/**
 * Creates a schedule together with its weekly rules in one transaction —
 * either the whole schedule is usable immediately, or nothing is created.
 */
async function createSchedule({ userId, name, timezone, isDefault, rules }) {
  return withTransaction(async (conn) => {
    const publicId = uuidv4();

    if (isDefault) {
      await conn.query("UPDATE schedules SET is_default = 0 WHERE user_id = ?", [userId]);
    }

    const [result] = await conn.query(
      `INSERT INTO schedules (public_id, user_id, name, timezone, is_default)
       VALUES (?, ?, ?, ?, ?)`,
      [publicId, userId, name, timezone, isDefault ? 1 : 0]
    );
    const scheduleId = result.insertId;

    for (const rule of rules) {
      await conn.query(
        `INSERT INTO availability_rules (schedule_id, days, start_time, end_time)
         VALUES (?, ?, ?, ?)`,
        [scheduleId, JSON.stringify(rule.days), rule.startTime, rule.endTime]
      );
    }

    return scheduleId;
  });
}

/**
 * Replaces a schedule's name/timezone/default flag and, if `rules` is
 * provided, replaces the entire set of weekly rules (delete + re-insert —
 * simpler and less error-prone than diffing old vs new rows for a table
 * this small).
 */
async function updateSchedule(scheduleId, userId, { name, timezone, isDefault, rules }) {
  return withTransaction(async (conn) => {
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (timezone !== undefined) {
      fields.push("timezone = ?");
      values.push(timezone);
    }
    if (isDefault !== undefined) {
      if (isDefault) {
        await conn.query("UPDATE schedules SET is_default = 0 WHERE user_id = ?", [userId]);
      }
      fields.push("is_default = ?");
      values.push(isDefault ? 1 : 0);
    }

    if (fields.length > 0) {
      values.push(scheduleId);
      await conn.query(`UPDATE schedules SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    if (rules !== undefined) {
      await conn.query("DELETE FROM availability_rules WHERE schedule_id = ?", [scheduleId]);
      for (const rule of rules) {
        await conn.query(
          `INSERT INTO availability_rules (schedule_id, days, start_time, end_time)
           VALUES (?, ?, ?, ?)`,
          [scheduleId, JSON.stringify(rule.days), rule.startTime, rule.endTime]
        );
      }
    }
  });
}

async function deleteSchedule(scheduleId) {
  await pool.query("DELETE FROM schedules WHERE id = ?", [scheduleId]);
}

async function addOverride(scheduleId, { date, isUnavailable, startTime, endTime }) {
  const [result] = await pool.query(
    `INSERT INTO schedule_overrides (schedule_id, date, is_unavailable, start_time, end_time)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_unavailable = VALUES(is_unavailable),
       start_time = VALUES(start_time),
       end_time = VALUES(end_time)`,
    [scheduleId, date, isUnavailable ? 1 : 0, startTime || null, endTime || null]
  );
  return result.insertId;
}

async function deleteOverride(overrideId, scheduleId) {
  await pool.query("DELETE FROM schedule_overrides WHERE id = ? AND schedule_id = ?", [
    overrideId,
    scheduleId,
  ]);
}

module.exports = {
  toPublicSchedule,
  findByPublicId,
  findById,
  listForUser,
  findDefaultForUser,
  getRules,
  getOverrides,
  getScheduleWithDetails,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  addOverride,
  deleteOverride,
};
