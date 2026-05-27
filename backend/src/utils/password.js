// src/utils/password.js
//
// Bcrypt wrappers. Always use these — never call bcrypt directly elsewhere
// in the codebase so the cost factor is consistent.

import bcrypt from 'bcryptjs';

// Cost factor — log2(rounds). 12 = 4096 rounds, ~100ms per hash on modern CPUs.
// Higher = slower = more resistant to brute force, but slower signup/login.
// Industry standard as of mid-2020s: 10–12. Bump when CPUs get faster.
const COST = 12;

// Hash a plaintext password. Bcrypt generates and embeds a unique salt for
// each call, so the same password produces different hashes every time.
// That defeats rainbow tables.
export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, COST);
}

// Constant-time compare of plaintext against a stored bcrypt hash.
// Bcrypt extracts the salt and cost from the hash and re-derives.
// Constant-time means an attacker can't infer information by timing.
export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}
