import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub as string;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
