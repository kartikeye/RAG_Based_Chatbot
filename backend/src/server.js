// src/server.js
//
// Server entry point. Opens the port, sets up graceful shutdown,
// and that's it.

import { app } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';

const server = app.listen(env.PORT, () => {
  console.log(`[server] Listening on http://localhost:${env.PORT}`);
  console.log(`[server] Environment: ${env.NODE_ENV}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// When the process receives SIGTERM (Docker stop, Kubernetes pod eviction,
// systemd service stop) or SIGINT (Ctrl+C), we want to:
//   1. Stop accepting new connections
//   2. Let in-flight requests complete (up to a timeout)
//   3. Close the Postgres connection pool
//   4. Exit cleanly
//
// Without this, the process gets SIGKILL'd after 10s with dropped requests
// and connections half-open.
async function shutdown(signal) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);

  // Force-exit if shutdown takes longer than 10 seconds (something is stuck).
  const forceExit = setTimeout(() => {
    console.error('[server] Forced exit after timeout');
    process.exit(1);
  }, 10_000);

  // Stop accepting new connections; existing ones finish.
  server.close(async (err) => {
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

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled promise rejections so they surface in logs instead of
// silently disappearing (default behavior in older Node).
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});
