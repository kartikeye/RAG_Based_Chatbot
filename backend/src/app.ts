import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import chatRoutes from './routes/chat.js';
import { errorHandler } from './middleware/error.js';

export const app = express();

// ---------------------------------------------------------------------------
// Reverse proxy trust — read this before changing it.
//
// req.ip is the basis of IP-based rate limiting, so how Express derives it
// decides whether that limiting works at all. There are three states:
//
//   trust proxy = false (default, correct for local dev)
//     req.ip is the socket's peer address. Behind nginx/ALB/Render that is
//     the PROXY's address, identical for every user — so every visitor on
//     earth lands in one rate-limit bucket.
//
//   trust proxy = true  (the tempting fix, and a security bug)
//     Express believes X-Forwarded-For unconditionally. That header is set
//     by the client, so an attacker sends a random value per request and
//     gets a fresh bucket every time — rate limiting becomes decorative.
//
//   trust proxy = <hop count> (the correct fix)
//     Express takes the Nth-from-last XFF entry, i.e. the address your own
//     proxy appended. A client-supplied prefix is ignored because it sits
//     further left in the list.
//
// So: set TRUST_PROXY to the number of proxies actually in front of this
// process — usually 1 — and leave it at 0 locally.
// ---------------------------------------------------------------------------
app.set('trust proxy', env.TRUST_PROXY);

app.use(helmet());   //it's a one-line way to apply Express's recommended security header defaults instead of configuring each one manually.

app.use(cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

app.use(morgan(env.isProd ? 'combined' : 'dev'));  //http logging : express

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/documents', documentRoutes);
app.use('/chat', chatRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);
