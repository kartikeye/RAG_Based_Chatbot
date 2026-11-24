import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

// Multer validates the upload (size, unexpected fields, etc.) inside its own
// middleware, before our route handler ever runs — so it throws a
// MulterError, not an HttpError. Map it to a proper 4xx here instead of
// letting it fall through to the generic 500 below.
const MULTER_ERROR_STATUS: Partial<Record<string, number>> = {
  LIMIT_FILE_SIZE: 413,
  LIMIT_UNEXPECTED_FILE: 400,
};

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const status = MULTER_ERROR_STATUS[err.code] ?? 400;
    res.status(status).json({ error: err.message });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
