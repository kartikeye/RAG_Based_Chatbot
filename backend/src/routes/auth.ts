import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { HttpError } from '../middleware/error.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// creates rate limiters to prevent abuse/brute-force attacks on auth endpoints:

const signupLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'signup' });
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'login' });

// zod : In auth.ts, it's likely used to validate signup/login request bodies (correct email format, 
// password length, required fields, etc.) and reject malformed requests with clear errors before they hit your business logic.

//set up the scehma for signup and validate the req.body
const signupSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

const DUMMY_HASH = '$2a$12$Cqr0bGqzZ.Y3.D6T0X0WyOhpVgRZW7eW2BzZ4Xkjz0p1Bv8FmCqOe';

router.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input', parsed.error.flatten());
    }
    const { email, password } = parsed.data;

    const passwordHash = await hashPassword(password);

    let userId: string;
    try {
      const result = await query<{ id: string }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id`,
        [email, passwordHash]
      );
      userId = result.rows[0].id;
    } catch (dbErr) {
      if ((dbErr as NodeJS.ErrnoException & { code?: string }).code === '23505') {
        throw new HttpError(409, 'Email already in use');
      }
      throw dbErr;
    }

    const token = signToken(userId);
    res.status(201).json({ token, user: { id: userId, email } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input');
    }
    const { email, password } = parsed.data;

    const result = await query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const passwordOk = await verifyPassword(password, hashToCheck);

    if (!user || !passwordOk) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, email } });
  } catch (err) {
    next(err);
  }
});

export default router;
