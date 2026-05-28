// src/utils/jwt.ts
//
// JWT helpers. We use HS256 (HMAC + SHA-256) because we only verify tokens
// in our own backend — no third party needs to verify them.
//
// If we ever needed third-party verification (e.g., an external service
// verifying our tokens without our secret), we'd switch to RS256 and
// distribute the public key. Common interview talking point.

import jwt, { type SignOptions, type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Sign a JWT whose `sub` claim is the user's id.
 *
 * Why only `sub`?
 *   Tokens are sent on every request — keeping the payload tiny limits
 *   damage if a token leaks, and lets role/permission changes take effect
 *   without waiting for the token to expire (we look those up by user_id
 *   each request).
 */
export function signToken(userId: string): string {
  // The cast here is intentional. jsonwebtoken v9 typed `expiresIn` as
  // `number | StringValue` (where StringValue is a `ms` package template
  // like "7d" / "15m"). Our env loader returns a plain `string`, so we
  // assert that the value follows the `ms` format. Misconfiguration is
  // caught at runtime by jsonwebtoken throwing.
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign({ sub: userId }, env.JWT_SECRET, options);
}

/**
 * Verify and decode a JWT. Throws if invalid, expired, or signature mismatch.
 * Returns the decoded payload with `sub` narrowed to a string for callers.
 */
export function verifyToken(token: string): JwtPayload & { sub: string } {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    // jwt.verify CAN return a string when the payload was signed as a string.
    // We always sign objects, so anything else is corrupt — treat it as invalid.
    throw new jwt.JsonWebTokenError('Invalid token payload shape');
  }
  return decoded as JwtPayload & { sub: string };
}
