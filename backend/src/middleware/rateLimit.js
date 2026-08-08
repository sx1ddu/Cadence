const { redis } = require("../config/redis");
const ApiError = require("../utils/ApiError");

/**
 * A small fixed-window rate limiter backed by Redis.
 *
 * How it works: for each client (by IP + a route-specific key prefix), we
 * INCR a Redis counter. On the FIRST increment in a window we set an
 * expiry equal to the window length. If the counter exceeds `max` before
 * it expires, we reject the request. This is the simplest correct rate
 * limiter you can build on Redis — no sliding window math, just
 * INCR + EXPIRE, which is easy to reason about and debug with `redis-cli`.
 *
 * Usage:
 *   router.post('/login', rateLimit({ keyPrefix: 'login', windowSec: 60, max: 10 }), ...)
 */
function rateLimit({ keyPrefix, windowSec, max }) {
  return async function (req, res, next) {
    try {
      const key = `ratelimit:${keyPrefix}:${req.ip}`;
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, windowSec);
      }

      if (count > max) {
        const ttl = await redis.ttl(key);
        res.set("Retry-After", String(ttl > 0 ? ttl : windowSec));
        throw ApiError.tooMany("Too many requests. Please try again shortly.");
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = rateLimit;
