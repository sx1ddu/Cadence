/**
 * The email queue.
 *
 * Why a queue instead of calling nodemailer directly in the controller:
 *   - SMTP calls can take seconds or time out; we don't want a signup
 *     request to hang waiting for an email provider.
 *   - BullMQ retries failed sends automatically (network blips, provider
 *     rate limits) without us writing retry logic by hand.
 *   - If the mail server is down, jobs just queue up in Redis and drain
 *     once it's back — nothing is lost.
 *
 * Any part of the app that wants to send an email calls
 * `emailQueue.add(jobName, payload)` — it never touches nodemailer
 * directly. The actual sending logic lives in
 * jobs/processors/email.processor.js, run by the worker process
 * (`npm run worker`).
 */
const { Queue } = require("bullmq");
const { redisConnectionOptions } = require("../../config/redis");

const emailQueue = new Queue("email", {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 }, // 5s, 10s, 20s, 40s, 80s
    removeOnComplete: 500, // keep the most recent 500 completed jobs for debugging
    removeOnFail: 1000,
  },
});

module.exports = emailQueue;
