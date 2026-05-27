// src/db/pool.js
//
// Postgres connection pool.
//
// Why a pool?
//   Opening a TCP+auth connection for every query is slow (~50ms) and would
//   exhaust Postgres's max_connections under load. A pool keeps a small set of
//   connections alive and hands them out per-query.

import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// Single shared pool — created once at module load, used everywhere.
//
// Sizing rule of thumb:
//   max connections per backend instance ≈ Postgres max_connections / N_backends
//   Default Postgres max_connections is 100. For one dev backend, 10 is plenty.
//
// idleTimeoutMillis: a connection idle for this long is closed and removed.
//   Keeps the pool from holding connections it doesn't need.
//
// connectionTimeoutMillis: if no connection is available within this time, error.
//   Tells us about pool exhaustion fast instead of hanging the request.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Surface pool-level errors. Without this listener, an error on an idle
// connection would crash the process.
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle Postgres client:', err);
});

// Convenience wrapper: run a parameterized query, return rows.
//
// ALWAYS use parameterized queries ($1, $2, ...). NEVER string-concatenate
// user input into SQL. The `pg` driver sends the SQL and the values
// separately to Postgres, which treats parameters as data, not code.
// This is the canonical defense against SQL injection.
//
// Example:
//   const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  // Lightweight query logging in dev — comment out in prod or replace with a
  // real logger like pino.
  if (!env.isProd) {
    console.log(`[db] ${duration}ms · rows=${result.rowCount} · ${text.split('\n')[0].trim().slice(0, 80)}`);
  }
  return result;
}

// Borrow a client for a transaction. Caller MUST release.
//
// Why a separate API for transactions?
//   A transaction spans multiple queries on the SAME connection. `query()`
//   above grabs whichever connection is free per call, so two queries from
//   the same JS function could land on two different connections — that
//   would break a transaction. For multi-query transactions, get one client
//   and use it for the whole BEGIN...COMMIT block.
//
// Pattern:
//   const client = await getClient();
//   try {
//     await client.query('BEGIN');
//     await client.query('INSERT ...');
//     await client.query('INSERT ...');
//     await client.query('COMMIT');
//   } catch (err) {
//     await client.query('ROLLBACK');
//     throw err;
//   } finally {
//     client.release();  // ALWAYS release, even on error
//   }
export async function getClient() {
  return pool.connect();
}

// Graceful shutdown — called from server.js on SIGTERM/SIGINT.
export async function closePool() {
  await pool.end();
  console.log('[db] Connection pool closed');
}
