import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {       //helper function to safetly read the environment varibale
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Copy backend/.env.example to backend/.env and fill it in.`
    );
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : defaultValue;
}

export const env = Object.freeze({
  PORT: parseInt(optional('PORT', '3000'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
  isProd: optional('NODE_ENV', 'development') === 'production',

  DATABASE_URL: required('DATABASE_URL'),

  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),

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

  CORS_ORIGINS: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),

  // How many reverse proxies sit in front of this app. See app.ts for why
  // this matters and why `true` is the wrong answer.
  //   unset / '0' / 'false' -> trust nobody (correct for local dev)
  //   '1'                   -> exactly one proxy (nginx, ALB, Render, Heroku)
  //   'loopback'            -> Express's named preset
  TRUST_PROXY: parseTrustProxy(optional('TRUST_PROXY', '0')),
});

/**
 * Express accepts a boolean, a hop count, or a preset/IP list for
 * `trust proxy`. We normalise the env string into one of those.
 *
 * Deliberately NOT supporting `true`: see the warning in app.ts.
 */
function parseTrustProxy(raw: string): number | string | false {
  const value = raw.trim().toLowerCase();
  if (value === '' || value === '0' || value === 'false') return false;

  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) return hops;

  if (value === 'true') {
    throw new Error(
      'TRUST_PROXY=true is unsafe: it makes Express trust any client-supplied ' +
      'X-Forwarded-For header, which lets anyone spoof their IP and bypass ' +
      'IP-based rate limiting. Set the number of proxies in front of this app ' +
      '(e.g. TRUST_PROXY=1), or a preset like "loopback".'
    );
  }

  // Named preset ('loopback', 'linklocal', 'uniquelocal') or a comma-separated
  // list of trusted proxy IPs/subnets — Express validates these itself.
  return value;
}

export type Env = typeof env;

if (env.JWT_SECRET.length < 32) {
  console.warn(
    '[config] WARNING: JWT_SECRET is shorter than 32 chars. ' +
    'Generate a stronger one for production.'
  );
}
