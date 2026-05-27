import { extractText } from './textExtractor.js';
import { chunkText, type Chunk } from './chunker.js';
import { embedText } from './bedrock.js';
import { getClient, query } from '../db/pool.js';

const EMBED_CONCURRENCY = 5;

export interface IngestParams {
  userId: string;
  documentId: string;
  buffer: Buffer;
  mimeType: string;
}

export interface IngestResult {
  chunkCount: number;
}

interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export async function ingestDocument({ userId, documentId, buffer, mimeType }: IngestParams): Promise<IngestResult> {
  try {
    const text = await extractText({ buffer, mimeType });
    if (text.length === 0) {
      await markDocument(documentId, 'failed', 0, 'Extracted text was empty');
      throw new Error('Extracted text was empty (is the PDF scanned or password-protected?)');
    }

    const pieces = chunkText(text);
    if (pieces.length === 0) {
      await markDocument(documentId, 'failed', 0, 'Chunker produced no chunks');
      throw new Error('Chunker produced no chunks');
    }

    const embeddings = await embedWithConcurrency(pieces, EMBED_CONCURRENCY);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const values: unknown[] = [];
      const placeholders: string[] = [];
      embeddings.forEach((chunk, i) => {
        const base = i * 6;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        values.push(
          documentId,
          userId,
          chunk.index,
          chunk.content,
          Math.ceil(chunk.content.length / 4),
          `[${chunk.embedding.join(',')}]`
        );
      });

      await client.query(
        `INSERT INTO chunks (document_id, user_id, chunk_index, content, token_count, embedding)
         VALUES ${placeholders.join(', ')}`,
        values
      );

      await client.query(
        `UPDATE documents
         SET status = 'ready', chunk_count = $1, updated_at = NOW()
         WHERE id = $2`,
        [embeddings.length, documentId]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      await markDocument(documentId, 'failed', 0, (txErr as Error).message);
      throw txErr;
    } finally {
      client.release();
    }

    return { chunkCount: embeddings.length };
  } catch (err) {
    try {
      await markDocument(documentId, 'failed', 0, (err as Error).message);
    } catch { /* swallow */ }
    throw err;
  }
}

async function embedWithConcurrency(pieces: Chunk[], concurrency: number): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = new Array(pieces.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= pieces.length) return;
      const piece = pieces[i];
      const embedding = await embedText(piece.content);
      results[i] = { ...piece, embedding };
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pieces.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function markDocument(
  documentId: string,
  status: string,
  chunkCount: number,
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE documents
     SET status = $1, chunk_count = $2, error_message = $3, updated_at = NOW()
     WHERE id = $4`,
    [status, chunkCount, errorMessage ?? null, documentId]
  );
}
