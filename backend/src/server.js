const env = require("./config/env");
const app = require("./app");
const { pingDatabase } = require("./config/db");
const { redis } = require("./config/redis");

async function start() {
  try {
    await pingDatabase();
    console.log("[server] MySQL connection OK");
  } catch (err) {
    console.error("[server] Could not connect to MySQL:", err.message);
    process.exit(1);
  }

  try {
    await redis.ping();
    console.log("[server] Redis connection OK");
  } catch (err) {
    console.error("[server] Could not connect to Redis:", err.message);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down gracefully...`);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
