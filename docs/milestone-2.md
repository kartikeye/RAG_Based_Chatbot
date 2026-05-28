# Milestone 2 — Backend skeleton + authentication

## What we built

A working Express backend with: environment-driven config, a Postgres connection pool, an AWS Bedrock client wrapper, JWT + bcrypt utilities, JWT auth middleware, centralized error handling, and signup/login routes. By the end of this milestone you can register a user, log in, and receive a JWT.

## How to run it

From the repo root (recommended — starts everything):

```bash
npm run install:all   # first time only
npm run dev           # starts Postgres + backend + frontend concurrently
```

Or to run just the backend in isolation:

```bash
cd C:\Kartikeye\Practise\RAG_Chatbot\RAG_Based_Chatbot
docker compose up -d                 # make sure Postgres is running
cd backend
cp .env.example .env                 # then EDIT .env with real AWS keys
npm install
npm run dev                          # tsx watch, restarts on save
```

In another terminal, test the auth endpoints:

```bash
# Health check
curl http://localhost:3000/health

# Signup
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"kartikeye@example.com","password":"hunter2hunter2"}'

# Login — save the returned token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"kartikeye@example.com","password":"hunter2hunter2"}'
```

Both should return `{ "token": "...", "user": { "id": "...", "email": "..." } }`.

## Interview talking points

### "Why split app.js and server.js?"

Construction (middleware, routes, error handlers) is separate from listening (opening a port). The benefit is testability — you can import the configured `app` into a test file and run it against supertest without ever opening a real TCP port. It also makes the entry point swappable: the same `app` can be served by a regular Node listener, a serverless adapter (AWS Lambda via `@vendia/serverless-express`), or a clustered process manager. This separation of concerns is the standard pattern in every production Node codebase.

### "How does your auth flow work?"

Stateless JWT-based auth. On signup, we bcrypt the password (cost factor 12 → ~100ms), insert the user, and immediately issue a JWT signed with HS256 containing only the user_id as `sub`. The client stores the token (in memory or httpOnly cookie) and includes it as `Authorization: Bearer <token>` on every protected request. The `requireAuth` middleware verifies the signature, decodes the user_id, attaches it to `req.userId`, and lets the request through. No session table, no per-request DB lookup for auth — pure cryptographic verification.

### "Why JWT instead of server-side sessions?"

JWT scales horizontally without a shared session store. If you have ten backend instances behind a load balancer, server-side sessions would need Redis (or sticky sessions, which is fragile). JWTs are self-contained and verifiable on any instance without coordination. The trade-off is **revocation is hard** — once you sign a 7-day JWT, you can't easily invalidate it before expiry. Production systems handle this with short-lived access tokens (15min) plus a refresh token (httpOnly cookie, server-tracked), giving you JWT's scalability with session-like revocation. For this project we use 7-day tokens and accept the limitation.

### "Why bcrypt over SHA-256?"

SHA-256 is fast — that's exactly why it's *wrong* for passwords. An attacker who steals the password_hash column can compute billions of SHA-256 hashes per second on a GPU and brute-force common passwords trivially. Bcrypt is *deliberately slow* (~100ms per hash) and has a tunable cost factor that can be increased as CPUs get faster. It also auto-salts every hash, so identical passwords don't produce identical hashes — defeating rainbow tables. Argon2 is the modern alternative and arguably better; bcrypt is more battle-tested. Either is acceptable; SHA-256 / MD5 / SHA-1 for passwords is malpractice.

### "Why do you run bcrypt even when the user doesn't exist?"

Defeats **timing-attack-based email enumeration**. Without it, the "no such user" path returns in ~1ms while the "user exists, wrong password" path takes ~100ms. An attacker who can measure response times can probe a list of emails and learn which are registered — useful information for targeted phishing or credential stuffing. By always computing a bcrypt hash (against a dummy stored hash when the user doesn't exist), both paths take the same ~100ms.

### "How do you prevent SQL injection?"

Every database call uses parameterized queries: the SQL string contains placeholders (`$1`, `$2`), and the values are passed separately. The `pg` driver ships the SQL and values as separate fields in the Postgres wire protocol, and Postgres treats parameters as data, never as code. Even if a user submits `'; DROP TABLE users; --` as their email, it goes into the database as a literal string. The cardinal rule: **never concatenate or interpolate user input into SQL**. Zod schema validation adds a second layer — we reject malformed input before it reaches the DB at all.

### "How is the Postgres connection pool sized?"

Pool max is set to 10 connections for one backend instance. The rule of thumb is `Postgres max_connections / number_of_backend_instances`, leaving headroom for admin connections. Default Postgres max_connections is 100, so 10 leaves room for several backend instances plus a few admin tools. Idle connections close after 30 seconds (don't hold what you don't need); requests waiting for a free connection give up after 5 seconds (surface pool exhaustion fast instead of hanging).

### "What does graceful shutdown do?"

On SIGTERM/SIGINT, we stop accepting new connections (`server.close()`), let existing in-flight requests finish, close the Postgres pool, then exit. A 10-second timeout force-kills the process if something is stuck. Without graceful shutdown, in-flight requests get dropped mid-response, and DB connections half-closed. Important for any container-deployed service — Docker, Kubernetes, ECS all send SIGTERM before SIGKILL.

### "Why does the JWT only contain user_id?"

Two reasons. **Size**: tokens are sent on every request — keeping the payload tiny reduces overhead and limits damage if a token leaks. **Freshness**: email, roles, and permissions can change. If we baked them into the token, a user demoted from admin would retain admin powers until their token expired. By looking up everything except identity at request time, role changes take effect immediately.

### "What does helmet actually do?"

Adds about a dozen HTTP security headers in one middleware call. Most important: `X-Content-Type-Options: nosniff` (browsers can't MIME-sniff and execute weird files), `X-Frame-Options: DENY` (prevents clickjacking via iframes), `Strict-Transport-Security` (forces HTTPS for the configured period), `X-DNS-Prefetch-Control` (privacy), and `Referrer-Policy` (limits referrer leakage). It's free defense in depth.

## What's next — Milestone 3

The ingestion pipeline: handle file upload (multer), extract text from PDF/TXT/DOCX, chunk the text with overlap, embed each chunk via Bedrock Titan, and INSERT into `chunks`. The user will be able to upload a document and watch their `chunks` table grow.
