// src/services/retrieval.ts
//
// Vector retrieval: given a query embedding and a userId, return the top-k
// most similar chunks (with their parent document's filename for citations).
//
// Why a separate service?
//   The chat orchestrator should not know about SQL. Routes ↔ services ↔ db
//   stays clean. Future swap of pgvector for Pinecone/Weaviate would only
//   touch this file.

import { getClient } from '../db/pool.js';

/**
 * One retrieved chunk + the cosine distance from the query.
 *
 * `distance` is pgvector's cosine distance (0 = identical direction,
 * 2 = opposite). For unit-normalized embeddings (Titan V2 with normalize:true),
 * this is equivalent to `1 - cosine_similarity`.
 */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  distance: number;
}

export interface RetrieveOptions {
  /** Number of nearest neighbors to fetch. Default 5. */
  k?: number;
  /**
   * ivfflat.probes — how many clusters the index scans at query time.
   * Higher = better recall, slower query. Default 10.
   */
  probes?: number;
}

/**
 * Retrieve the top-k chunks for a user, ordered by cosine distance ascending
 * (nearest first). Multi-tenant safe: the WHERE clause filters by user_id
 * BEFORE the vector search ranks, so user A never sees user B's chunks.
 */
export async function retrieveTopK(
  userId: string,
  queryEmbedding: number[],
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1024) {
    throw new Error(
      `retrieveTopK: query embedding must be a 1024-dim array (got length ${queryEmbedding?.length})`
    );
  }
  const k = options.k ?? 5;
  const probes = options.probes ?? 10;

  // pgvector wants the embedding as a string like '[0.1, 0.2, ...]'.
  // The ::vector cast in the SQL converts it to the column type.
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  // We use an explicit client + transaction so that `SET LOCAL` for
  // ivfflat.probes only affects this query. Without the transaction,
  // SET would leak into whichever request next borrows this connection.
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ivfflat.probes = ${probes}`);

    const result = await client.query<{
      id: string;
      document_id: string;
      filename: string;
      chunk_index: number;
      content: string;
      distance: string;  // pg returns numeric as string by default
    }>(
      `SELECT
         c.id,
         c.document_id,
         d.filename,
         c.chunk_index,
         c.content,
         c.embedding <=> $1::vector AS distance
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       WHERE c.user_id = $2
       ORDER BY c.embedding <=> $1::vector
       LIMIT $3`,
      [embeddingLiteral, userId, k]
    );

    await client.query('COMMIT');

    return result.rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      filename: row.filename,
      chunkIndex: row.chunk_index,
      content: row.content,
      // Postgres returns the computed distance as a string for numeric/float
      // types in some configurations; coerce to number for consumers.
      distance: typeof row.distance === 'string' ? parseFloat(row.distance) : row.distance,
    }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
