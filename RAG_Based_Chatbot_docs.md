# RAG Chatbot — Master Interview Prep

This document consolidates the highest-signal talking points from all five milestone docs into a single reference you can review before any interview where RAG, system design, or full-stack Node/React comes up. Read the individual milestone docs for deeper explanations.

---

## "Walk me through what you built."

A multi-tenant RAG chatbot. Users sign up, upload documents (PDF, DOCX, plain text), and ask questions. The system answers *strictly from the uploaded documents* — if nothing relevant is found, it says "This is out of my expertise to answer."

**Full data flow:**

```
Upload: HTTP multipart → multer buffer → text extractor → recursive chunker
        → Bedrock Titan embed (bounded concurrency) → pgvector INSERT (single tx)

Query:  POST /chat → embed question → pgvector cosine search (scoped by user_id)
        → distance threshold filter → Claude 3.5 Haiku (grounded prompt) → JSON response
```

**Stack:** React 18 + Vite + TypeScript (frontend) · Express + TypeScript (backend) · Postgres + pgvector (vector store) · AWS Bedrock Claude 3.5 Haiku (generation) · Amazon Titan Text Embeddings V2 (embeddings) · Docker Compose (local DB).

---

## System design

### "Why pgvector over Pinecone / Weaviate / Qdrant?"

Three reasons. **Operational simplicity** — we already need a relational DB for users and document metadata. pgvector puts vector search and relational data in one transaction: `INSERT INTO documents` and `INSERT INTO chunks` either both commit or both roll back. With a dedicated vector DB you need a two-phase write and a reconciliation job. **Rich filtering** — SQL `WHERE user_id = $1 AND created_at > $2` before the similarity ranking is native in pgvector. Dedicated stores treat metadata filtering as second-class. **Cost and ops** — Postgres is everywhere. No new vendor, no new SDK, no new alerting. The trade-off: at hundreds of millions of vectors, HNSW-native stores scale horizontally better. For anything under ~10M vectors and a few hundred QPS, pgvector is the right call.

### "ivfflat or HNSW — why ivfflat?"

Both are approximate nearest-neighbor (ANN) algorithms. ivfflat k-means-partitions vectors into clusters and at query time scans only the nearest `probes` clusters (we set `probes=10` for ~95% recall). HNSW builds a multi-layer proximity graph — higher recall, faster query latency at high QPS, but slower index builds and ~3–5× more memory. For a learning project where write throughput and memory matter more than sub-millisecond P99 latency, ivfflat wins. Mention HNSW as "the upgrade path."

### "Why cosine distance, not L2 or inner product?"

Titan V2 returns unit-normalized vectors (`normalize: true`). For unit-normalized embeddings, vector direction carries all the semantic signal — magnitude is irrelevant. L2 penalizes magnitude differences that have no meaning in text. Inner product is numerically equivalent to cosine on unit vectors, but cosine is the documented intention and makes the code self-explaining. pgvector operator: `<=>`.

### "How do you enforce multi-tenancy?"

Three layers. **Schema**: every `chunks` row carries a denormalized `user_id` column. **Query**: every vector search is `WHERE c.user_id = $1` *before* ranking — the SQL itself is the boundary, not just the route handler. **Auth**: `user_id` comes from a verified JWT; the client never specifies which user's data to query. A data leak would require breaking JWT verification *and* bypassing parameterized queries simultaneously.

### "Why denormalize user_id onto chunks?"

Pure normalization joins chunks → documents to get `user_id` on every search query — an extra join on a table that may have millions of rows. Denormalizing eliminates that join. The cost: if document ownership transferred (it doesn't in this app), you'd update two tables. Classic OLTP rule: **denormalize the columns that appear in hot-path WHERE clauses.**

---

## Ingestion pipeline

### "Walk me through ingestion."

1. **Upload** — multer parses multipart, gives a memory buffer + metadata.
2. **DB record** — INSERT `documents` row with `status='processing'` so the client sees the document immediately.
3. **Text extraction** — format-specific: pdf-parse for PDF, mammoth for DOCX, UTF-8 decode for plain text.
4. **Chunking** — recursive character splitter: try paragraph break → sentence → word → character, ~2000 chars (~500 tokens) with 200-char overlap.
5. **Embedding** — Bedrock Titan V2, bounded concurrency N=5 (parallel speedup without triggering rate limits).
6. **Persist** — all chunks INSERTed in a single transaction; `documents.status` flipped to `ready`. Any failure rolls back and sets `failed`.

### "Why recursive character splitting, not fixed-size?"

Fixed-size splits cut mid-sentence, producing chunks whose embeddings are incoherent. Recursive splitting respects natural semantic boundaries — paragraphs first, then sentences, then words, then characters as a last resort. This is faster and cheaper than semantic chunking (which embeds every sentence to plan the splits) and produces retrieval quality close to it in practice.

### "Why 2000 chars / 500 tokens with 200-char overlap?"

Too small → chunks lose surrounding context; embeddings are meaningless fragments. Too large → one 1024-dim vector averages 1000 tokens of meaning; retrieval precision drops. 500 tokens is the industry sweet spot. 200-char overlap (≈50 tokens) ensures sentences that straddle a chunk boundary appear whole in at least one chunk. Cost: ~10% more chunks stored.

### "Why bounded concurrency (N=5) for embeddings, not Promise.all?"

`Promise.all` on 200 chunks fires 200 simultaneous Bedrock requests. Titan's rate limit (~2000 RPM in most regions) causes ThrottlingExceptions mid-ingestion. Sequential is the other extreme: 200 × 100ms = 20s per document. Bounded concurrency at N=5 gives 5× speedup while staying inside rate limits. Same pattern applies to any rate-limited downstream: use `p-limit`, `p-queue`, or inline semaphore.

### "Why a single transaction for chunk INSERTs?"

Without a transaction, a failure mid-INSERT leaves orphan chunks for a `failed` document. Retries are complicated. With `BEGIN … COMMIT`, either all chunks land or none do. Retries are trivial: zero chunks, re-upload, clean run. **Make the system easy to reason about by eliminating partial states.**

### "Synchronous ingestion — when would you go async?"

Synchronous is fine when uploads are short (< 60s). Switch to async at three points: **long documents** (> ~50 pages, breaches HTTP timeouts); **concurrent uploads** (each upload holds an Express slot); **cost control** (a worker queue throttles globally). Async pattern: return `202 Accepted` with a document ID, push buffer to S3 + job to SQS, worker polls from queue, client polls `GET /documents/:id`.

---

## Chat / RAG query path

### "Walk me through a chat request."

1. **Validate** — Zod schema rejects blanks and inputs > 4000 chars before any model is touched.
2. **Embed question** — same Titan V2 model used during ingestion (different models → incomparable vector spaces).
3. **Vector search** — `SELECT … ORDER BY embedding <=> $2 LIMIT 5` with `WHERE user_id = $1`. ivfflat.probes=10 set per-connection via `SET LOCAL`.
4. **Threshold filter** — drop any chunk with cosine distance ≥ 0.8 (strong matches sit at 0.2–0.6 for Titan V2 normalized).
5. **Short-circuit** — if nothing passes the filter, return `{ answer: "This is out of my expertise…", grounded: false }` without calling Claude.
6. **Generate** — Claude 3.5 Haiku with system prompt that forbids outside-knowledge answers and `temperature: 0`.
7. **Respond** — `{ answer, grounded: true, sources: [{filename, chunkIndex, distance}], usage }`.

### "Why a relevance threshold? Why not just send everything to Claude?"

**Cost** — a Claude call is ~100× more expensive than an embed call. No relevant chunks → skip the call entirely. **Latency** — the LLM step is the slow step (500–1500ms); short-circuiting makes "out of expertise" near-instant. **Quality** — weak context tempts the model to reach and generate confident-sounding hallucinations. The threshold (0.8) is tunable; production systems often expose it as a config knob per tenant.

### "How do you prevent hallucination?"

Four layers. (1) Threshold gate: no relevant chunks → no Claude call. (2) Grounded system prompt: "answer ONLY from the context block; otherwise return the exact string…". (3) `temperature: 0`: deterministic output, no creative sampling. (4) Source citations in the response: user can verify the answer came from their documents. None alone is perfect; together they make hallucination rare enough to ship.

### "Why must the embedding model be the same on both sides?"

Embeddings from different models live in different 1024-dimensional spaces — the axes encode different latent features. Nearest-neighbor search across mixed-model vectors is meaningless. Migration strategy: dual-write (compute old + new embeddings for new content while backfilling old), cut over reads, drop the old column.

### "Cost estimate?"

Ingestion: ~$0.001 per 100-page document (Titan embed ~$0.00002/1k tokens). Query: ~$0.001 per question (1 Titan embed + 1 Claude Haiku call at ~$0.25/M input tokens, ~$1.25/M output tokens). 1000 questions ≈ $1. The "out of expertise" path is nearly free (embed only, no Claude).

---

## Authentication & security

### "How does your auth flow work?"

Stateless JWT. Signup: bcrypt password (cost 12, ~100ms), INSERT user, return signed JWT with `sub=user_id`. Login: fetch user, bcrypt compare, return JWT. Every protected request includes `Authorization: Bearer <token>`; `requireAuth` middleware verifies the signature and attaches `req.userId`. No session table, no per-request DB lookup for auth.

### "JWT vs server-side sessions?"

JWT scales horizontally without a shared session store — any backend instance can verify any token with just the secret. Sessions need Redis or sticky sessions (fragile) in a multi-instance setup. Trade-off: **revocation is hard**. A stolen 7-day JWT is valid until expiry. Production fix: short-lived access tokens (15min) + refresh token in an httpOnly cookie, with server-tracked refresh token revocation.

### "Why bcrypt, not SHA-256?"

SHA-256 is fast — billions of hashes/second on a GPU. Bcrypt is *deliberately slow* (~100ms), salted per-hash, and has a tunable cost factor that scales with hardware. Identical passwords produce different hashes (defeats rainbow tables). Argon2 is the modern alternative; bcrypt is more battle-tested. SHA-256/MD5/SHA-1 for passwords is malpractice.

### "Why run bcrypt even when the user doesn't exist?"

Timing-attack email enumeration: without it, "no such user" returns in 1ms; "wrong password" takes 100ms. An attacker measuring response times can probe a list of emails to discover which are registered. Always running bcrypt normalizes the response time to ~100ms on both paths.

### "How do you prevent SQL injection?"

Parameterized queries everywhere — SQL contains `$1`, `$2` placeholders; values travel separately in the Postgres wire protocol. The DB treats parameters as data, never as code. Zod schema validation rejects malformed input before it reaches the DB. Defense in depth.

### "Prompt injection — where's the risk?"

Two entry points. (1) Document content: a PDF could embed `"Ignore all prior instructions…"` — that text becomes part of the context block. Defense: we wrap chunks in `<context>…</context>` tags and the system prompt tells Claude to treat tag contents as data. (2) User questions: capped at 4000 chars to limit padding attacks. **Prompt injection is the SQL injection of LLMs** — that framing lands in interviews.

### "What does helmet do?"

Adds ~12 HTTP security headers: `X-Content-Type-Options: nosniff` (no MIME sniffing), `X-Frame-Options: DENY` (no clickjacking), `Strict-Transport-Security` (forces HTTPS), `Referrer-Policy` (limits leak). Free defense in depth, one middleware call.

---

## TypeScript

### "Why TypeScript on the backend?"

Three reasons. **Compile-time safety** — typos and wrong types fail at save, not at runtime inside a production route handler. **Self-documenting interfaces** — Bedrock response shapes, Postgres row types, and `req.userId` are all explicit and refactor-safe. **Team signal** — strict-mode TypeScript is the default at modern Node shops.

### "What does strict mode actually do?"

`"strict": true` enables a dozen flags. Most important: `strictNullChecks` (null/undefined are first-class types; you must handle them before using a value), `noImplicitAny` (every parameter must be typed — the single most valuable flag). Combined: the type system is trustworthy and autocomplete is useful.

### "Why .js extension in TypeScript imports?"

TypeScript with ESM+NodeNext does not rewrite import specifiers at compile time. The runtime sees exactly what you write. Since Node ESM requires explicit `.js` extensions, source files must write the compiled path even though the file on disk is `.ts`. TypeScript resolves `env.js` back to `env.ts` at type-check time. Rule: **write the runtime path, not the source path.** This trips up every developer the first time.

### "How did you add req.userId to Express?"

Module augmentation in `src/types/express.d.ts` — `declare global { namespace Express { interface Request { userId?: string } } }`. The `export {}` at the bottom makes TypeScript treat the file as a module so the augmentation is honored. Typed as optional because not every route goes through `requireAuth`.

---

## Frontend

### "Why Vite over Create React App?"

CRA was deprecated in 2023. Vite uses esbuild for the dev server (cold starts < 1s vs CRA's 30+s), native ESM in the browser (only imports what's actually needed, on demand), and Rollup for production (smaller, better tree-shaking). The answer in interviews: CRA is dead; Vite/Next.js/Remix are the options.

### "Why React Context for auth, not Redux or Zustand?"

Auth is read-heavy, write-rare. All protected routes and the API client read auth state; only login/signup/logout mutate it. Context is purpose-built for that. No extra dependency. Zustand/Redux pay off for more complex shared state (undo, notifications, high-frequency updates) — for auth alone, Context is the right call.

### "JWT in localStorage — what's wrong with it?"

Any XSS-vulnerable script can read `localStorage`. A stored-XSS bug compromises tokens. Production alternative: access token in JavaScript memory only (survives a page refresh), refresh token in an `httpOnly` cookie (unreadable by JS). Silent refresh on expiry via `/auth/refresh`. We chose localStorage knowing the limitation and documented it — that's the honest interview answer.

### "Why `<Navigate>` for protected routes, not `useEffect + navigate()`?"

`<Navigate>` is declarative: on first render, if `!isAuthenticated`, React returns a redirect element before painting. The user never sees the protected page. The imperative approach renders the protected page first, then redirects in `useEffect` — one frame of protected content is visible. Bad UX and a security smell.

### "How does the Vite dev proxy work?"

`vite.config.ts` `server.proxy` forwards `/auth`, `/documents`, `/chat`, `/health` to `http://localhost:3000`. Frontend code calls `fetch('/documents')` — same-origin, zero CORS overhead. In production the built `dist/` folder is served from the same Express origin (or a reverse proxy), so relative paths still work.

---

## Operations

### "How do you start the whole project with one command?"

From the repo root:
```bash
npm run dev
```
`predev` starts the Docker Postgres container (`docker start rag_postgres || docker compose up -d`). `dev` runs `concurrently` with backend (`tsx watch`) and frontend (`vite`) in parallel, colour-coded in the terminal. `--kill-others-on-fail` stops both if either crashes.

### "What does graceful shutdown do?"

On SIGTERM/SIGINT: stop accepting new connections (`server.close()`), let in-flight requests finish, close the Postgres pool, exit. 10-second hard-kill timeout for stuck requests. Without this, Docker/Kubernetes send SIGTERM and then SIGKILL — in-flight requests are dropped mid-response and DB connections are half-closed.

### "What would change at production scale?"

- **Async ingestion**: SQS + Lambda/ECS worker instead of inline; return `202 Accepted`.
- **Connection pooling**: PgBouncer in transaction mode in front of Postgres, not per-instance pools.
- **Streaming**: `InvokeModelWithResponseStreamCommand` for token-by-token Claude output.
- **Auth**: short-lived access tokens + httpOnly refresh token (revocable).
- **HNSW index**: replace ivfflat for higher QPS or recall requirements.
- **Observability**: structured JSON logs, Bedrock cost tracking per user, Postgres slow-query alerts.
- **Tests**: Vitest for unit tests, Playwright for E2E.

---

## Known limitations (articulate these proactively)

| Limitation | Production fix |
|---|---|
| No streaming | `InvokeModelWithResponseStreamCommand` + Transfer-Encoding: chunked |
| No conversation history | Pass last N turns in prompt or summarize them |
| JWT in localStorage | httpOnly cookie + short-lived access token + refresh token |
| No upload progress | XMLHttpRequest with onprogress, or fetch upload streams |
| No tests | Vitest (unit) + Playwright (E2E) |
| Synchronous ingestion | 202 Accepted + SQS/Lambda worker |
