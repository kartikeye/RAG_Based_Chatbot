# Milestone 1 — Infrastructure foundations

This document captures what we built in Milestone 1, *why* we built it that way, and the interview-grade rationale for every decision. Re-read this before any interview where RAG, vector databases, or system design might come up.

## What we set up

1. Project folder layout: `backend/`, `frontend/`, `db/`, `docs/`
2. `.gitignore` to keep secrets and build artifacts out of version control
3. `docker-compose.yml` for a one-command Postgres + pgvector dev database
4. `db/init/01_schema.sql` with `users`, `documents`, `chunks` tables and a vector index

## How to start the database

```bash
cd C:\Kartikeye\Practise\RAG_Chatbot\RAG_Based_Chatbot
docker compose up -d           # starts Postgres in the background
docker compose logs postgres   # tail logs if you want to watch the boot
docker compose down            # stop, keep data
docker compose down -v         # stop AND wipe data (start fresh)
```

Connect to the DB with `psql` or any GUI tool (TablePlus, DBeaver) using:

```
host:     localhost
port:     5432
user:     rag_user
password: rag_password
database: rag_chatbot
```

To verify pgvector is installed, after connecting run:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

You should see one row.

---

## Interview talking points — be able to answer each of these cold

### "Why pgvector instead of a dedicated vector DB like Pinecone or Weaviate?"

Three reasons. First, **operational simplicity** — we already need a relational database for users and document metadata, and pgvector lets us keep everything in one transactional store. We can `INSERT INTO documents` and `INSERT INTO chunks` inside a single transaction; if either fails, neither commits. With a separate vector DB, we would need a two-phase write and a reconciliation job. Second, **rich filtering** — pgvector lets us combine vector similarity with SQL `WHERE` clauses ("nearest chunks where `user_id = $1` and `created_at > $2`"). Dedicated vector DBs are getting better at this but still treat metadata filtering as a second-class citizen. Third, **cost and ops** — Postgres is already on every cloud, every dev machine, every CI runner. No new vendor, no new SDK, no new alerting setup. The trade-off shows up at scale (hundreds of millions of vectors), where dedicated vector DBs scale horizontally better. For a portfolio project or any system under tens of millions of vectors, pgvector is the right call.

### "Why ivfflat instead of HNSW for the vector index?"

Both are approximate nearest neighbor (ANN) algorithms — they trade a tiny amount of recall for huge speed improvements over brute-force search. **ivfflat** partitions vectors into clusters via k-means; at query time it scans only the nearest `probes` clusters. It is fast to build, uses little memory, has slightly lower recall, and degrades gracefully as data grows. **HNSW** (Hierarchical Navigable Small World) builds a multi-layer graph where each layer is a sparser version of the layer below; queries traverse top-down from sparse to dense. It is slower to build, uses more memory, but has higher recall and faster query latency at high QPS. For a learning project where data volume is modest and write-throughput matters more than P99 query latency, ivfflat wins. At very high QPS or with hundreds of millions of vectors, HNSW pulls ahead.

### "Why cosine distance instead of L2 or inner product?"

Titan V2 — like most modern text embedding models — returns vectors that are approximately unit-normalized. Their magnitudes carry no semantic meaning; their direction does. Cosine distance measures the angle between two vectors and ignores magnitude entirely, which is exactly what we want. With L2 distance, two vectors pointing the same way but with slightly different magnitudes would look "far apart" — a false signal. With cosine, they correctly look similar. Inner product is mathematically equivalent to cosine on unit-normalized vectors but doesn't enforce that assumption; it's used when you have specific reasons to weight magnitude (e.g., importance-weighted embeddings).

### "Why 1024 dimensions?"

That is the output dimensionality of Amazon Titan Text Embeddings V2 — it's not a knob we pick, it's a property of the model. Higher dimensions tend to encode more semantic nuance but cost more to store and search. Common embedding dimensions: OpenAI text-embedding-3-small at 1536, Cohere Embed at 1024, Titan V2 at 256/512/**1024**. We chose Titan because it's in the same Bedrock account as Claude Haiku, so one IAM setup covers both, and 1024 dimensions strike a balance between quality and cost.

### "How do you enforce multi-tenancy — that user A's documents never leak into user B's answers?"

Three layers of defense. **Layer 1: schema.** Every chunk row carries a `user_id` column (denormalized from `documents`). **Layer 2: query.** Every vector search includes `WHERE user_id = $1` *before* the similarity ranking, so only the requesting user's chunks are even considered as candidates. **Layer 3: auth middleware.** The Express `/chat` route reads `user_id` from a JWT — the client never gets to specify which user's data to query. Combined, these three layers mean a leak requires breaking JWT verification *and* a SQL injection that bypasses parameterized queries. Both are individually defended.

### "Why denormalize user_id onto chunks instead of joining through documents?"

Pure normalization would put `user_id` only on `documents`, and we'd join chunks → documents to filter by user. That works, but the JOIN executes for *every* vector search, on a table that may have millions of rows. By denormalizing, we save a join at query time. The cost is that if a document changes ownership (rare in this app — documents don't transfer between users) we'd need to update both tables. The classic OLTP trade-off: **denormalize the columns that appear in your hot query path's WHERE clauses.**

### "What happens to chunks if a user deletes their account?"

`ON DELETE CASCADE` on the foreign keys: deleting a user auto-deletes their documents, which auto-deletes their chunks. One DELETE, full cleanup. This also helps with GDPR-style data deletion requests — one row removed, all derived data goes with it.

---

## What's next — Milestone 2

We'll start the Express backend: package.json, environment loading, AWS SDK + Bedrock client setup, the auth routes (signup / login with bcrypt and JWT), and a database connection pool. By the end of Milestone 2 you'll be able to register a user and get back a JWT.

Then Milestone 3 will be the ingestion pipeline (upload → extract → chunk → embed → store), and Milestone 4 will be the chat endpoint with vector search and Claude Haiku generation. Milestone 5 wraps it up with the React UI.
