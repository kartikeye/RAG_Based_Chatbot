// src/app.js
//
// Builds and exports the configured Express app.
// Does NOT open a port — server.js is responsible for that.
//
// Why split?
//   Keeping the app construction separate from the listen call lets us
//   import { app } from tests without starting a real server. Standard
//   pattern in every production Express codebase.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import { errorHandler } from './middleware/error.js';

export const app = express();

// ---------------------------------------------------------------------------
// Middleware stack — ORDER MATTERS.
// ---------------------------------------------------------------------------

// 1. Security headers FIRST so they go on every response, including errors.
app.use(helmet());

// 2. CORS — must come before any route that the frontend will call.
//    Preflight requests (OPTIONS) need this to succeed before the real request.
app.use(cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
}));

// 3. JSON body parsing — populates req.body for application/json requests.
//    The limit prevents an attacker from sending a 1GB JSON body that
//    exhausts memory. 1mb is generous for auth + chat payloads.
app.use(express.json({ limit: '1mb' }));

// 4. Request logging — handy in dev. In prod replace with a structured
//    logger like pino + a log aggregator.
app.use(morgan(env.isProd ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
// Health check — useful for load balancers and quick "is it up" pings.
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/documents', documentRoutes);
// Future: app.use('/chat', chatRoutes);

// ---------------------------------------------------------------------------
// 404 handler — anything that didn't match a route lands here.
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------------------------------------------------------
// Error handler — MUST be the LAST .use() call.
// Express identifies error handlers by their 4-arg signature.
// ---------------------------------------------------------------------------
app.use(errorHandler);
