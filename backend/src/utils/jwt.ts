import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signToken(userId: string): string {
  return jwt.sign(
    { sub: userId },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): jwt.JwtPayload & { sub: string } {
  return jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { sub: string };
}
