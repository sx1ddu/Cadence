const { Queue } = require("bullmq");
const { redisConnectionOptions } = require("../../config/redis");

/**
 * Outbound webhook deliveries. Separate queue from email, since these two
 * have different failure characteristics (a downstream customer's server
 * being flaky shouldn't compete for retry slots with our own SMTP calls)
 * and different retry needs (webhooks fail more often, since the endpoint
 * is on the OTHER end of the internet and outside our control).
 */
const webhookQueue = new Queue("webhook-delivery", {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10000 }, // 10s, 20s, 40s, 80s, 160s
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

module.exports = webhookQueue;
