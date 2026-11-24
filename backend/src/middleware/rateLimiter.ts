// src/middleware/rateLimiter.ts
//
// A small in-memory fixed-window rate limiter.
//
// WHO gets counted is configurable, because "one bucket per IP" is the wrong
// answer for authenticated routes:
//   - An attacker rotating IPs (trivial on IPv6, where one customer is handed
//     a whole /64) gets a fresh bucket per address.
//   - Everyone behind one NAT gateway — an office, a university, a mobile
//     carrier — shares a single bucket and throttles each other.
// So authenticated routes key on the user id (stable, and creating more of
// them costs an account), while pre-auth routes like signup/login have no
// user id yet and must fall back to IP.
//
// LIMITATION (state this before an interviewer asks): the store is a
// process-local Map. It resets on restart and is not shared between
// instances, so N replicas means N times the effective limit. Past one
// process this moves to Redis (INCR + EXPIRE) or an API-gateway limiter.

import type { Request, Response, NextFunction, RequestHandler } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  /**
   * How to identify the caller. Defaults to `ipKey`.
   * Use `userKey` on routes mounted AFTER `requireAuth`.
   */
  keyGenerator?: (req: Request) => string;
}

const store = new Map<string, RateLimitRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now >= record.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Identify the caller by IP.
 *
 * `req.ip` is only trustworthy if `trust proxy` is configured correctly in
 * app.ts — see the note there. Misconfigured, this is either always the
 * proxy's IP (one bucket for the whole world) or a client-spoofable header.
 */
export function ipKey(req: Request): string {
  return `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
}

/**
 * Identify the caller by authenticated user id.
 *
 * Falls back to IP if `req.userId` is missing, which should be impossible on
 * a route mounted after `requireAuth` — but failing open to *no* limit would
 * be worse than failing over to a coarser one.
 */
export function userKey(req: Request): string {
  return req.userId ? `user:${req.userId}` : ipKey(req);
}

export function createRateLimiter({
  windowMs,
  max,
  keyPrefix = '',
  keyGenerator = ipKey,
}: RateLimiterOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${keyPrefix}:${keyGenerator(req)}`;
    const now = Date.now();

    let record = store.get(key);
    if (!record || now >= record.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (record.count >= max) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'Too many requests, please try again later.' });
      return;
    }

    record.count++;
    next();
  };
}
