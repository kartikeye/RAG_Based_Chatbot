import { app } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';

const server = app.listen(env.PORT, () => {
  console.log(`[server] Listening on http://localhost:${env.PORT}`);
  console.log(`[server] Environment: ${env.NODE_ENV}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[server] Forced exit after timeout');
    process.exit(1);
  }, 10_000);

  server.close(async (err?: Error) => {
    if (err) {
      console.error('[server] Error during shutdown:', err);
      process.exit(1);
    }
    await closePool();
    clearTimeout(forceExit);
    console.log('[server] Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});
