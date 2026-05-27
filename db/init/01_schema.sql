-- ============================================================================
-- RAG Chatbot — Initial schema
-- ============================================================================
-- This file is auto-applied by Docker on FIRST container start
-- (via the docker-entrypoint-initdb.d mount in docker-compose.yml).
--
-- To re-apply after editing, you need a fresh volume:
--     docker compose down -v && docker compose up -d
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
-- pgvector: adds the `vector` column type and similarity operators.
--   <-> = L2 / euclidean distance
--   <#> = (negative) inner product
--   <=> = cosine distance  ← we use this one
-- We use cosine because Titan V2 returns normalized embeddings, so direction
-- (semantic meaning) matters, not magnitude.
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto: gives us gen_random_uuid() for primary keys.
-- UUIDs > serial IDs for multi-tenant apps because they don't leak row counts
-- and can't be guessed (no enumeration attacks like /documents/1, /documents/2).
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
-- Standard auth table. Passwords are stored as bcrypt hashes — never plaintext.
-- The bcrypt hashing happens in the Express layer; the DB just stores the hash.
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,                  -- bcrypt hash, ~60 chars
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup-by-email is the hot path for login. UNIQUE already creates an index,
-- so no extra index needed here.


-- ----------------------------------------------------------------------------
-- documents
-- ----------------------------------------------------------------------------
-- One row per uploaded file. Stores metadata only — NOT the file contents.
-- The raw file we either delete after extraction (cheaper) or save to S3.
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,                  -- original filename as uploaded
    mime_type       TEXT NOT NULL,                  -- 'application/pdf', etc.
    size_bytes      BIGINT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'processing',  -- processing | ready | failed
    error_message   TEXT,                                -- populated on failure
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical index for the "list my documents" endpoint.
-- Every query that hits this table filters by user_id (multi-tenancy isolation),
-- so user_id is in every index we create here.
CREATE INDEX idx_documents_user_id_created
    ON documents (user_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- chunks
-- ----------------------------------------------------------------------------
-- The heart of the RAG system. Each row = one chunk of text + its embedding.
-- A 50-page PDF might produce ~150 rows here.
CREATE TABLE chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- ^ user_id is DENORMALIZED here on purpose. Yes, we could JOIN through
    --   documents to get it, but having it on chunks means we can filter by
    --   user_id directly in the vector search WHERE clause — much faster than
    --   joining 100k+ rows against documents. This is a classic OLTP-vs-OLAP
    --   denormalization trade-off and a great interview talking point.
    chunk_index     INTEGER NOT NULL,               -- 0, 1, 2... position in source doc
    content         TEXT NOT NULL,                  -- the actual text of the chunk
    token_count     INTEGER,                        -- approx, useful for cost analysis
    embedding       vector(1024) NOT NULL,          -- ← THE vector. 1024 = Titan V2 dims.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- B-tree index for "fetch all chunks of this document in order"
-- (e.g., when showing the user what was indexed).
CREATE INDEX idx_chunks_document
    ON chunks (document_id, chunk_index);

-- B-tree index for "scope vector search to one user".
-- We filter by user_id BEFORE the vector search runs, so this matters.
CREATE INDEX idx_chunks_user_id
    ON chunks (user_id);

-- ============================================================================
-- THE VECTOR INDEX — the magic ingredient
-- ============================================================================
-- ivfflat (Inverted File with Flat compression) clusters embeddings into
-- buckets using k-means. At query time, only the nearest `probes` buckets
-- are scanned instead of the entire table.
--
-- The `lists` parameter is the number of buckets:
--   rule of thumb: rows / 1000  (for up to 1M rows)
--                  sqrt(rows)   (for more than 1M rows)
-- We start with 100 because we have very few rows. Re-tune as the table grows.
--
-- vector_cosine_ops tells the index to optimize for the <=> (cosine) operator.
-- If we wanted L2 distance, we'd use vector_l2_ops instead.
--
-- Trade-off vs HNSW:
--   ivfflat: smaller index, faster builds, slightly lower recall
--   hnsw:    larger index, slower builds, higher recall + faster queries
-- For a learning project, ivfflat is the right pick.
CREATE INDEX idx_chunks_embedding_cosine
    ON chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- NOTE: ivfflat needs data to build properly. Postgres will create an EMPTY
-- index now (no data yet), and queries will still work — they just fall back
-- to a sequential scan until the index is rebuilt with real data.
-- After loading a meaningful number of rows (a few hundred+), run:
--     REINDEX INDEX idx_chunks_embedding_cosine;
