/**
 * Worker process entry point.
 *
 * This is a SEPARATE process from the API server (start it with
 * `npm run worker`, typically in its own terminal / container / PM2
 * process). It pulls jobs off Redis-backed queues and executes them.
 * Keeping it separate means a slow email provider or a crashing job
 * processor can never take down the HTTP API.
 */
require("../../config/env"); // validates env vars early
const { Worker } = require("bullmq");
const { redisConnectionOptions } = require("../../config/redis");
const processEmailJob = require("../processors/email.processor");
const processWebhookDelivery = require("../processors/webhook.processor");
const { startReminderSweep } = require("../cron/reminderSweep");

const emailWorker = new Worker("email", processEmailJob, {
  connection: redisConnectionOptions,
  concurrency: 5,
});

emailWorker.on("completed", (job) => {
  console.log(`[worker:email] ✓ job ${job.id} (${job.name}) sent to ${job.data.to}`);
});

emailWorker.on("failed", (job, err) => {
  console.error(`[worker:email] ✗ job ${job?.id} (${job?.name}) failed:`, err.message);
});

const webhookWorker = new Worker("webhook-delivery", processWebhookDelivery, {
  connection: redisConnectionOptions,
  concurrency: 10, // webhook deliveries are mostly I/O-wait, safe to run more concurrently than email
});

webhookWorker.on("completed", (job) => {
  console.log(`[worker:webhook] ✓ delivered ${job.data.eventType} to ${job.data.targetUrl}`);
});

webhookWorker.on("failed", (job, err) => {
  console.error(`[worker:webhook] ✗ delivery to ${job?.data?.targetUrl} failed:`, err.message);
});

console.log("[worker] email + webhook workers started, waiting for jobs...");
startReminderSweep();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[worker] SIGTERM received, closing workers...");
  await Promise.all([emailWorker.close(), webhookWorker.close()]);
  process.exit(0);
});
