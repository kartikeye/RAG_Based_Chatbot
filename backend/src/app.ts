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

app.use(helmet());

app.use(cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

app.use(morgan(env.isProd ? 'combined' : 'dev'));

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
