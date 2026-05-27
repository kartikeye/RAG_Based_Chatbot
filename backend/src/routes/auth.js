// src/routes/auth.js
//
// Authentication routes:
//   POST /auth/signup  — create a new user, return a JWT
//   POST /auth/login   — verify credentials, return a JWT

import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { HttpError } from '../middleware/error.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// 5 signup attempts per IP per 15 minutes — prevents account-creation spam.
const signupLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'signup' });
// 10 login attempts per IP per 15 minutes — throttles brute-force/credential stuffing.
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'login' });

// ---------------------------------------------------------------------------
// Input schemas — zod validates the request body BEFORE any DB work happens.
// ---------------------------------------------------------------------------
const signupSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

// A precomputed bcrypt hash of the string "dummy-password-for-timing".
// Used in login when the user doesn't exist, so the "no user" code path
// still spends ~100ms doing bcrypt work — defeats timing-based email
// enumeration. The hash format is bcrypt's standard `$2a$12$...`.
const DUMMY_HASH = '$2a$12$Cqr0bGqzZ.Y3.D6T0X0WyOhpVgRZW7eW2BzZ4Xkjz0p1Bv8FmCqOe';

// ---------------------------------------------------------------------------
// POST /auth/signup
// ---------------------------------------------------------------------------
router.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    // 1. Validate input. zod throws ZodError on failure — we map to HttpError 400.
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input', parsed.error.flatten());
    }
    const { email, password } = parsed.data;

    // 2. Hash password BEFORE the DB insert. If the DB insert fails (e.g.,
    //    duplicate email), at least we never log or stored the plaintext.
    const passwordHash = await hashPassword(password);

    // 3. Insert. The UNIQUE constraint on email throws Postgres error 23505
    //    if the email is taken; we translate that to a clean 409 Conflict.
    let userId;
    try {
      const result = await query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id`,
        [email, passwordHash]
      );
      userId = result.rows[0].id;
    } catch (dbErr) {
      if (dbErr.code === '23505') {  // unique_violation
        throw new HttpError(409, 'Email already in use');
      }
      throw dbErr;
    }

    // 4. Issue a JWT so the client is logged in immediately.
    const token = signToken(userId);
    res.status(201).json({ token, user: { id: userId, email } });
  } catch (err) {
    next(err);  // hand off to the centralized error handler
  }
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input');
    }
    const { email, password } = parsed.data;

    const result = await query(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

    // ALWAYS run the bcrypt compare, even when the user doesn't exist.
    // This makes the response time identical for "no such user" and
    // "wrong password" — defeats timing-based enumeration.
    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const passwordOk = await verifyPassword(password, hashToCheck);

    if (!user || !passwordOk) {
      // Same vague error for both cases — don't tell the attacker which one.
      throw new HttpError(401, 'Invalid email or password');
    }

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, email } });
  } catch (err) {
    next(err);
  }
});

export default router;
