// src/services/ollama.ts
//
// Ollama-backed embeddings + generation — the free, local counterpart to
// bedrock.ts. Same exported function signatures as bedrock.ts on purpose:
// aiProvider.ts swaps between them with zero changes to ingestion.ts or
// chat.ts.
//
// Requires a local Ollama install (https://ollama.com) with the configured
// models pulled:
//   ollama pull mxbai-embed-large   (1024-dim — matches the `vector(1024)` column)
//   ollama pull llama3.1

import { env } from '../config/env.js';

const MAX_EMBED_CHARS = 32_000;
const MAX_QUESTION_CHARS = 4_000;

async function ollamaFetch<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `ollama: could not reach ${env.OLLAMA_BASE_URL} — is Ollama running? ` +
      `(${(err as Error).message})`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ollama: ${path} failed with ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

export async function embedText(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string') {
    throw new Error('embedText: text must be a non-empty string');
  }
  if (text.length > MAX_EMBED_CHARS) {
    throw new Error(`embedText: input exceeds ${MAX_EMBED_CHARS} character limit`);
  }

  const payload = await ollamaFetch<{ embedding: number[] }>('/api/embeddings', {
    model: env.OLLAMA_EMBEDDING_MODEL,
    prompt: text,
  });

  if (!Array.isArray(payload.embedding) || payload.embedding.length !== 1024) {
    throw new Error(
      `embedText: unexpected response shape (embedding length = ${payload.embedding?.length}). ` +
      `Does "${env.OLLAMA_EMBEDDING_MODEL}" produce 1024-dim vectors? Run: ollama pull mxbai-embed-large`
    );
  }
  return payload.embedding;
}

export interface GenerateAnswerParams {
  question: string;
  contextChunks: { content: string }[];
}

export interface GenerateAnswerResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateAnswer({ question, contextChunks }: GenerateAnswerParams): Promise<GenerateAnswerResult> {
  if (!question || typeof question !== 'string') {
    throw new Error('generateAnswer: question must be a non-empty string');
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw new Error(`generateAnswer: question exceeds ${MAX_QUESTION_CHARS} character limit`);
  }

  const contextBlock = contextChunks
    .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
    .join('\n\n---\n\n');

  const systemPrompt =
    `You are a helpful assistant. Answer the user's question using ONLY the ` +
    `information provided in the context sources below. If the answer is not ` +
    `contained in the sources, respond exactly with: ` +
    `"This is out of my expertise to answer." Do not use outside knowledge. ` +
    `Do not speculate. Cite sources by their [Source N] tag where relevant.`;

  const payload = await ollamaFetch<{
    message?: { content: string };
    prompt_eval_count?: number;
    eval_count?: number;
  }>('/api/chat', {
    model: env.OLLAMA_GENERATION_MODEL,
    stream: false,
    options: { temperature: 0 },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `<context>\n${contextBlock}\n</context>\n\nQuestion: ${question}` },
    ],
  });

  return {
    text: payload.message?.content ?? '',
    inputTokens: payload.prompt_eval_count ?? 0,
    outputTokens: payload.eval_count ?? 0,
  };
}
