const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/db");
const { parseJsonColumn } = require("../../utils/json");

function toPublicWebhook(row) {
  return {
    id: row.public_id,
    targetUrl: row.target_url,
    eventTypes: parseJsonColumn(row.event_types),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    // secret is intentionally never returned after creation — see
    // webhook.service.js's createWebhook comment.
  };
}

async function findByPublicId(publicId) {
  const [rows] = await pool.query("SELECT * FROM webhooks WHERE public_id = ? LIMIT 1", [publicId]);
  return rows[0] || null;
}

async function listForUser(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

/** Every ACTIVE webhook a user has subscribed to a given event type — used when firing an event. */
async function listActiveForUserAndEvent(userId, eventType) {
  const [rows] = await pool.query(
    `SELECT * FROM webhooks
     WHERE user_id = ? AND is_active = 1
       AND JSON_CONTAINS(event_types, JSON_QUOTE(?))`,
    [userId, eventType]
  );
  return rows;
}

async function create({ userId, targetUrl, secret, eventTypes }) {
  const publicId = uuidv4();
  const [result] = await pool.query(
    `INSERT INTO webhooks (public_id, user_id, target_url, secret, event_types)
     VALUES (?, ?, ?, ?, ?)`,
    [publicId, userId, targetUrl, secret, JSON.stringify(eventTypes)]
  );
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.query("SELECT * FROM webhooks WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

async function update(id, { targetUrl, eventTypes, isActive }) {
  const fields = [];
  const values = [];
  if (targetUrl !== undefined) {
    fields.push("target_url = ?");
    values.push(targetUrl);
  }
  if (eventTypes !== undefined) {
    fields.push("event_types = ?");
    values.push(JSON.stringify(eventTypes));
  }
  if (isActive !== undefined) {
    fields.push("is_active = ?");
    values.push(isActive ? 1 : 0);
  }
  if (fields.length === 0) return findById(id);
  values.push(id);
  await pool.query(`UPDATE webhooks SET ${fields.join(", ")} WHERE id = ?`, values);
  return findById(id);
}

async function remove(id) {
  await pool.query("DELETE FROM webhooks WHERE id = ?", [id]);
}

async function recordDelivery({ webhookId, eventType, payload, status, responseCode, attempts }) {
  await pool.query(
    `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, response_code, attempts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [webhookId, eventType, JSON.stringify(payload), status, responseCode || null, attempts]
  );
}

async function listDeliveries(webhookId, limit = 50) {
  const [rows] = await pool.query(
    "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?",
    [webhookId, limit]
  );
  return rows;
}

module.exports = {
  toPublicWebhook,
  findByPublicId,
  findById,
  listForUser,
  listActiveForUserAndEvent,
  create,
  update,
  remove,
  recordDelivery,
  listDeliveries,
};
