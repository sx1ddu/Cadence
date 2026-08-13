const crypto = require("crypto");
const ApiError = require("../../utils/ApiError");
const webhookRepo = require("./webhook.repository");
const webhookQueue = require("../../jobs/queues/webhook.queue");

async function listMyWebhooks(userId) {
  const rows = await webhookRepo.listForUser(userId);
  return rows.map(webhookRepo.toPublicWebhook);
}

/**
 * Creates a webhook and returns its signing secret ONE TIME ONLY, in the
 * creation response — exactly like an API key. The secret itself is
 * still stored in the database (we need it to sign every future
 * delivery), but toPublicWebhook never includes it in later reads, so a
 * compromised read-only endpoint can't leak it after the fact.
 */
async function createWebhook(userId, input) {
  const secret = crypto.randomBytes(32).toString("hex");
  const webhook = await webhookRepo.create({
    userId,
    targetUrl: input.targetUrl,
    secret,
    eventTypes: input.eventTypes,
  });
  return { ...webhookRepo.toPublicWebhook(webhook), secret };
}

async function getOwnedWebhookOr404(publicId, userId) {
  const webhook = await webhookRepo.findByPublicId(publicId);
  if (!webhook) throw ApiError.notFound("Webhook not found.");
  if (webhook.user_id !== userId) throw ApiError.forbidden("This isn't your webhook.");
  return webhook;
}

async function updateWebhook(publicId, userId, input) {
  const webhook = await getOwnedWebhookOr404(publicId, userId);
  const updated = await webhookRepo.update(webhook.id, input);
  return webhookRepo.toPublicWebhook(updated);
}

async function deleteWebhook(publicId, userId) {
  const webhook = await getOwnedWebhookOr404(publicId, userId);
  await webhookRepo.remove(webhook.id);
}

async function listDeliveries(publicId, userId) {
  const webhook = await getOwnedWebhookOr404(publicId, userId);
  return webhookRepo.listDeliveries(webhook.id);
}

/**
 * Called from the booking lifecycle (see booking.service.js) whenever
 * something webhook-worthy happens. Looks up every ACTIVE webhook this
 * host has subscribed to this event type, and enqueues one delivery job
 * per webhook — actual HTTP delivery happens in the background worker
 * (jobs/processors/webhook.processor.js), so a slow or broken subscriber
 * endpoint never blocks the booking request itself.
 */
async function fireEvent(userId, eventType, payload) {
  const webhooks = await webhookRepo.listActiveForUserAndEvent(userId, eventType);
  for (const webhook of webhooks) {
    await webhookQueue.add("deliver", {
      webhookId: webhook.id,
      targetUrl: webhook.target_url,
      secret: webhook.secret,
      eventType,
      payload,
    });
  }
}

module.exports = {
  listMyWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listDeliveries,
  fireEvent,
};
