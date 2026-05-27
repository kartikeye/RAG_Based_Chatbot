// src/config/env.js
//
// Centralized environment configuration.
// Reads process.env exactly ONCE at boot, validates required vars,
// and exports a frozen config object that the rest of the app imports.
//
// Why validate at boot?
//   We want the server to refuse to start if it's misconfigured, rather than
//   crashing on the first request that needs JWT_SECRET three hours later.

import dotenv from 'dotenv';

// Load .env into process.env. In production we usually rely on the platform
// to inject env vars directly (Docker, ECS, Kubernetes secrets), so dotenv
// is essentially a development convenience.
dotenv.config();

// Helper: read a required env var or throw with a clear message.
function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Copy backend/.env.example to backend/.env and fill it in.`
    );
  }
  return value;
}

// Helper: read an optional env var with a default.
function optional(name, defaultValue) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : defaultValue;
}

export const env = Object.freeze({
  // Server
  PORT: parseInt(optional('PORT', '3000'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
  isProd: optional('NODE_ENV', 'development') === 'production',

  // Database
  DATABASE_URL: required('DATABASE_URL'),

  // JWT
  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),

  // AWS Bedrock
  // AWS_REGION is required. Credentials (ACCESS_KEY_ID / SECRET_ACCESS_KEY)
  // are optional here because the AWS SDK uses its own default provider chain:
  // env vars → ~/.aws/credentials → EC2/ECS/Lambda IAM role. In production,
  // attach an IAM role to the compute instance instead of using static keys.
  AWS_REGION: required('AWS_REGION'),
  BEDROCK_EMBEDDING_MODEL_ID: optional(
    'BEDROCK_EMBEDDING_MODEL_ID',
    'amazon.titan-embed-text-v2:0'
  ),
  BEDROCK_GENERATION_MODEL_ID: optional(
    'BEDROCK_GENERATION_MODEL_ID',
    'anthropic.claude-3-haiku-20240307-v1:0'
  ),

  // CORS
  CORS_ORIGINS: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
});

// Sanity: warn if JWT_SECRET looks weak
if (env.JWT_SECRET.length < 32) {
  console.warn(
    '[config] WARNING: JWT_SECRET is shorter than 32 chars. ' +
    'Generate a stronger one for production.'
  );
}
