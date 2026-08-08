/**
 * Shared Redis client.
 *
 * Used for three distinct purposes in this app:
 *   1. Caching (e.g. computed availability slots for a short TTL)
 *   2. Short-lived tokens / rate-limit counters
 *   3. BullMQ needs its own connection config (see jobs/queues) — BullMQ
 *      creates its own ioredis instances internally, but we export the
 *      connection options here so every queue/worker uses the same config.
 */
const Redis = require("ioredis");
const env = require("./env");

const redisConnectionOptions = {
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  maxRetriesPerRequest: null, // required by BullMQ
};

const redis = new Redis(redisConnectionOptions);

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});

module.exports = { redis, redisConnectionOptions };
