const crypto = require("crypto");
const webhookRepo = require("../../modules/webhooks/webhook.repository");

/**
 * Delivers one webhook event: POSTs the JSON payload to the subscriber's
 * URL, signed with an HMAC-SHA256 header so the receiver can verify the
 * request genuinely came from Cadence (the same pattern Cadence's own
 * Razorpay webhook handler uses to verify ITS inbound webhooks — same
 * idea, opposite direction).
 *
 * BullMQ handles retries automatically (see webhook.queue.js's
 * attempts/backoff config) by re-throwing on failure — this function
 * just needs to throw when delivery didn't succeed, and BullMQ does the
 * rest (including eventually giving up and marking the job failed).
 */
async function processWebhookDelivery(job) {
  const { webhookId, targetUrl, secret, eventType, payload } = job.data;

  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  let responseCode = null;
  let succeeded = false;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cadence-Event": eventType,
        "X-Cadence-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10000), // don't let a hung endpoint block the worker forever
    });
    responseCode = response.status;
    succeeded = response.status >= 200 && response.status < 300;
  } catch (err) {
    // Network error, DNS failure, timeout, etc. — no response code to record.
    succeeded = false;
  }

  await webhookRepo.recordDelivery({
    webhookId,
    eventType,
    payload,
    status: succeeded ? "success" : "failed",
    responseCode,
    attempts: job.attemptsMade + 1,
  });

  if (!succeeded) {
    // Throwing tells BullMQ this attempt failed, triggering its
    // configured retry/backoff — see webhook.queue.js.
    throw new Error(`Webhook delivery to ${targetUrl} failed (status: ${responseCode ?? "no response"})`);
  }
}

module.exports = processWebhookDelivery;
