// src/middleware/rateLimiter.js
//
// Lightweight in-memory rate limiter.
// Tracks request counts per IP within a sliding window and rejects with 429
// once the limit is exceeded.
//
// Not suitable for multi-process deployments (use Redis-backed rate limiting
// there). For a single-process Node server this is sufficient.

const store = new Map(); // key -> { count, resetAt }

// Purge expired entries every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now >= record.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref(); // .unref() so this timer never keeps the process alive

/**
 * createRateLimiter({ windowMs, max, keyPrefix })
 *
 * Returns an Express middleware that allows `max` requests per IP within
 * `windowMs` milliseconds. `keyPrefix` scopes counters per route.
 */
export function createRateLimiter({ windowMs, max, keyPrefix = '' }) {
  return (req, res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let record = store.get(key);
    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      store.set(key, record);
      return next();
    }

    if (record.count >= max) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    record.count++;
    next();
  };
}
