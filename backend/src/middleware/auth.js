// src/middleware/auth.js
//
// JWT authentication middleware.
//
// Reads `Authorization: Bearer <token>`, verifies the JWT, and attaches
// req.userId for downstream routes. Returns 401 on any failure.

import { verifyToken } from '../utils/jwt.js';

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  // Expected format: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice('Bearer '.length).trim();

  try {
    const payload = verifyToken(token);
    // Attach for downstream handlers. From this point on, any route can
    // trust req.userId belongs to the authenticated user.
    req.userId = payload.sub;
    next();
  } catch (err) {
    // jsonwebtoken throws different error types — TokenExpiredError,
    // JsonWebTokenError. We treat them all as 401 to avoid leaking which
    // type of failure occurred (that would help token-guessing attacks).
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
