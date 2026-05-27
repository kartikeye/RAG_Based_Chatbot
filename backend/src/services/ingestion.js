// src/services/ingestion.js
//
// Orchestrates the full ingestion pipeline:
//   1. Extract text from buffer
//   2. Chunk text
//   3. Embed each chunk (bounded concurrency)
//   4. INSERT all chunks in a single transaction
//   5. Mark document as ready (or failed)
//
// Interview points:
//   - Bounded concurrency: 5 embeddings in flight at a time. Sequential is
//     too slow, fully parallel triggers Bedrock throttling.
//   - Single transaction: either all chunks land or none do — no partial
//     states to clean up.
//   - Status field on documents: 'processing' → 'ready' | 'failed' gives the
//     client a clear lifecycle to render in the UI.

import { extractText } from './textExtractor.js';
import { chunkText } from './chunker.js';
import { embedText } from './bedrock.js';
import { getClient, query } from '../db/pool.js';

const EMBED_CONCURRENCY = 5;

/**
 * ingestDocument({ userId, documentId, buffer, mimeType })
 *
 * Runs the full pipeline. Updates the documents row with status and
 * chunk_count, and inserts every chunk in a single transaction.
 *
 * Throws on failure (caller decides whether to swallow or propagate).
 */
export async function ingestDocument({ userId, documentId, buffer, mimeType }) {
  try {
    // ---------- 1. Extract ----------
    const text = await extractText({ buffer, mimeType });
    if (text.length === 0) {
      await markDocument(documentId, 'failed', 0, 'Extracted text was empty');
      throw new Error('Extracted text was empty (is the PDF scanned or password-protected?)');
    }

    // ---------- 2. Chunk ----------
    const pieces = chunkText(text);
    if (pieces.length === 0) {
      await markDocument(documentId, 'failed', 0, 'Chunker produced no chunks');
      throw new Error('Chunker produced no chunks');
    }

    // ---------- 3. Embed (bounded concurrency) ----------
    // Build an array of { content, index, embedding } once embeddings are ready.
    const embeddings = await embedWithConcurrency(pieces, EMBED_CONCURRENCY);

    // ---------- 4. Persist atomically ----------
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Bulk insert all chunks. Building a parameterized multi-row INSERT
      // is faster than N round-trips and still safe against SQL injection.
      const values = [];
      const placeholders = [];
      embeddings.forEach((chunk, i) => {
        // 6 columns: document_id, user_id, chunk_index, content, token_count, embedding
        const base = i * 6;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        values.push(
          documentId,
          userId,
          chunk.index,
          chunk.content,
          Math.ceil(chunk.content.length / 4), // crude token estimate
          // pgvector wants a string like '[0.1, 0.2, ...]' for parameterized INSERTs
          `[${chunk.embedding.join(',')}]`
        );
      });

      await client.query(
        `INSERT INTO chunks (document_id, user_id, chunk_index, content, token_count, embedding)
         VALUES ${placeholders.join(', ')}`,
        values
      );

      // Update the documents row to 'ready'.
      await client.query(
        `UPDATE documents
         SET status = 'ready', chunk_count = $1, updated_at = NOW()
         WHERE id = $2`,
        [embeddings.length, documentId]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      await markDocument(documentId, 'failed', 0, txErr.message);
      throw txErr;
    } finally {
      client.release();
    }

    return { chunkCount: embeddings.length };
  } catch (err) {
    // Best-effort: ensure the document is marked failed even if something
    // earlier in the pipeline threw before we set status.
    try {
      await markDocument(documentId, 'failed', 0, err.message);
    } catch { /* swallow */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// embedWithConcurrency — runs `concurrency` embedText calls in parallel,
// preserving the input order in the output.
// ---------------------------------------------------------------------------
// Why not Promise.all over all pieces?
//   A 200-chunk document would fire 200 simultaneous Bedrock calls and
//   trigger ThrottlingException. Bounded concurrency is the standard
//   pattern for rate-limited APIs.
async function embedWithConcurrency(pieces, concurrency) {
  const results = new Array(pieces.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= pieces.length) return;
      const piece = pieces[i];
      const embedding = await embedText(piece.content);
      results[i] = { ...piece, embedding };
    }
  }

  // Spawn N workers; they cooperatively drain the array.
  const workers = Array.from({ length: Math.min(concurrency, pieces.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// markDocument — small helper to update document status.
// ---------------------------------------------------------------------------
async function markDocument(documentId, status, chunkCount, errorMessage) {
  await query(
    `UPDATE documents
     SET status = $1, chunk_count = $2, error_message = $3, updated_at = NOW()
     WHERE id = $4`,
    [status, chunkCount, errorMessage ?? null, documentId]
  );
}
