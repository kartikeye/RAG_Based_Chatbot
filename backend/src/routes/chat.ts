// src/routes/chat.ts
//
// POST /chat — the user asks a question, we answer from their documents.
//
// Security and cost guardrails:
//   - requireAuth so we know whose corpus to search
//   - rate limiter (30 questions per user per hour) — chat costs real $$
//   - zod schema clamps question length, blocking prompt-injection padding
//   - the heavy lifting (embed + search + generate) lives in src/services/chat.ts

import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { createRateLimiter, userKey } from '../middleware/rateLimiter.js';
import { HttpError } from '../middleware/error.js';
import { answerQuestion } from '../services/chat.js';

const router = Router();

// 30 chat requests per user per hour — chat costs real money per call.
//
// Keyed on the authenticated userId, NOT the IP, so a shared corporate or
// campus NAT doesn't put every employee in one bucket, and so an attacker
// can't reset their allowance by rotating IP addresses. This only works
// because the limiter is mounted AFTER requireAuth below — req.userId does
// not exist before that middleware runs.
const chatLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyPrefix: 'chat',
  keyGenerator: userKey,
});

// MAX_QUESTION_CHARS = 4000 in bedrock.ts. Match here so we 400 BEFORE
// embedding work happens (saves a model call on bad input).
const chatSchema = z.object({
  question: z.string().min(1).max(4000).trim(),
});

router.post('/', requireAuth, chatLimiter, async (req, res, next) => {
  try {
    if (!req.userId) {
      // Belt-and-braces — requireAuth guarantees this, but TS doesn't know that.
      throw new HttpError(401, 'Not authenticated');
    }

    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input', parsed.error.flatten());
    }
    const { question } = parsed.data;

    const result = await answerQuestion(req.userId, question);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
