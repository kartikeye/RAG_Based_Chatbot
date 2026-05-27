// src/middleware/error.js
//
// Centralized error handler. Mounted LAST in the middleware stack.
//
// Express recognizes an error handler by its 4-argument signature
// (err, req, res, next). When any prior middleware or route calls
// next(err) or throws inside an async handler that's been wrapped to
// forward errors, Express jumps directly here.
//
// We export a tiny custom error class so route code can do:
//   throw new HttpError(409, 'Email already in use');
// instead of manually doing res.status(409).json(...) inside the route.
// That keeps routes terse and lets the handler centralize logging.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function errorHandler(err, req, res, _next) {
  // Known HTTP error — emit the intended status and message.
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Unknown error — log details server-side but DON'T leak the stack to
  // the client. Leaking stack traces in production is a common security issue.
  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}
