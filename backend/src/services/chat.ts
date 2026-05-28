// src/services/chat.ts
//
// Chat orchestrator. Ties the whole RAG pipeline together at query time:
//   1. Embed the user's question (same model used for chunks → comparable vectors)
//   2. Retrieve top-k similar chunks scoped to this user
//   3. Filter by relevance threshold — if nothing's close enough, short-circuit
//   4. Build sources + grounded prompt
//   5. Call Claude Haiku for the final answer
//
// Interview talking point — the threshold gate:
//   If retrieval returns nothing relevant, we DON'T waste a Claude call.
//   We directly return the "out of expertise" message. This is faster, cheaper,
//   and removes the risk of Claude inventing answers from weak context.

import { embedText, generateAnswer } from './bedrock.js';
import { retrieveTopK, type RetrievedChunk } from './retrieval.js';

/**
 * Distance threshold for "this chunk is actually relevant."
 * pgvector cosine distance is 0 (identical) to 2 (opposite).
 * For Titan V2 normalized embeddings, useful matches typically sit
 * between 0.2 and 0.6. We pick 0.8 as the conservative "almost certainly
 * unrelated" cutoff.
 */
const RELEVANCE_DISTANCE_THRESHOLD = 0.8;

/** Exact text we return when nothing relevant is in the user's corpus. */
export const OUT_OF_EXPERTISE_MESSAGE = 'This is out of my expertise to answer.';

export interface ChatResult {
  answer: string;
  /** Whether the answer came from the LLM or the short-circuit message. */
  grounded: boolean;
  /** The chunks (after filtering) that were sent to the LLM. */
  sources: Array<{
    documentId: string;
    filename: string;
    chunkIndex: number;
    distance: number;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Run the full RAG query path for a single question.
 */
export async function answerQuestion(
  userId: string,
  question: string
): Promise<ChatResult> {
  // 1. Embed the question with the SAME model used for chunks.
  //    Different model → vectors that can't be meaningfully compared.
  const queryEmbedding = await embedText(question);

  // 2. Retrieve top-k candidates, scoped to this user.
  const candidates = await retrieveTopK(userId, queryEmbedding, { k: 5 });

  // 3. Threshold filter — keep only chunks that are actually close to the query.
  const relevant: RetrievedChunk[] = candidates.filter(
    (c) => c.distance < RELEVANCE_DISTANCE_THRESHOLD
  );

  // 4. Short-circuit: if nothing is relevant (empty corpus or unrelated
  //    question), skip the LLM call entirely.
  if (relevant.length === 0) {
    return {
      answer: OUT_OF_EXPERTISE_MESSAGE,
      grounded: false,
      sources: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // 5. Generate. The system prompt inside generateAnswer() instructs Claude
  //    to answer ONLY from the provided context, or return the out-of-expertise
  //    string verbatim — so even Claude has a second chance to refuse.
  const { text, inputTokens, outputTokens } = await generateAnswer({
    question,
    contextChunks: relevant.map((c) => ({ content: c.content })),
  });

  return {
    answer: text,
    grounded: true,
    sources: relevant.map((c) => ({
      documentId: c.documentId,
      filename: c.filename,
      chunkIndex: c.chunkIndex,
      distance: c.distance,
    })),
    usage: { inputTokens, outputTokens },
  };
}
