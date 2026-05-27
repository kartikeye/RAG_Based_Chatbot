// src/utils/jwt.js
//
// JWT helpers. We use HS256 (HMAC + SHA-256) because we only verify tokens
// in our own backend — no third party needs to verify them.
//
// If we ever needed third-party verification (e.g., an external service
// verifying our tokens without our secret), we'd switch to RS256 and
// distribute the public key. Common interview talking point.

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Sign a token containing the user_id. That's all the auth state we need —
// everything else (email, roles) can be looked up from the DB by user_id.
// Keeping the payload tiny keeps tokens small and limits damage if a token leaks.
export function signToken(userId) {
  return jwt.sign(
    { sub: userId },           // 'sub' (subject) is the standard JWT field for user identity
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

// Verify and decode a token. Throws if invalid, expired, or signature mismatch.
// Returns the decoded payload (which contains sub = user_id).
export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}
