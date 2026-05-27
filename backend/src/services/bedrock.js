// src/services/bedrock.js
//
// Thin wrapper over the AWS Bedrock Runtime client.
//
// Bedrock exposes one method (`InvokeModel`) that takes a modelId and a
// JSON body. The body shape is model-specific:
//
//   Titan Embeddings V2:
//     request:  { inputText: string, dimensions?: 256|512|1024, normalize?: bool }
//     response: { embedding: number[], inputTextTokenCount: number }
//
//   Claude (Anthropic on Bedrock):
//     request:  { anthropic_version, max_tokens, system?, messages: [{role, content}] }
//     response: { content: [{type:'text', text}], usage: {input_tokens, output_tokens}, ... }
//
// We hide both behind two clean functions: embedText() and generateAnswer().

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { env } from '../config/env.js';

// One client, reused for every request. The SDK manages an underlying
// HTTPS connection pool to AWS, so reusing the client is the fast path.
// Credentials are resolved by the SDK's default provider chain:
//   1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars (dev/.env)
//   2. ~/.aws/credentials file
//   3. EC2/ECS/Lambda instance metadata (production IAM role — no static keys needed)
const client = new BedrockRuntimeClient({
  region: env.AWS_REGION,
});

// ---------------------------------------------------------------------------
// embedText — turn a string into a 1024-dim vector using Titan V2
// ---------------------------------------------------------------------------
// Used in TWO places:
//   1. During ingestion, on every chunk of an uploaded document.
//   2. At query time, on the user's chat message.
// Both paths MUST use the same model — embedding A with model X and embedding
// B with model Y produces vectors that can't be meaningfully compared.
// Titan Embeddings V2 accepts up to 8192 tokens (~32 KB of text).
// Enforcing a hard limit here prevents runaway costs from oversized inputs.
const MAX_EMBED_CHARS = 32_000;
// Claude Haiku context window is 200k tokens, but we cap questions to a
// reasonable size to prevent prompt-injection padding attacks.
const MAX_QUESTION_CHARS = 4_000;

export async function embedText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('embedText: text must be a non-empty string');
  }
  if (text.length > MAX_EMBED_CHARS) {
    throw new Error(`embedText: input exceeds ${MAX_EMBED_CHARS} character limit`);
  }

  const body = {
    inputText: text,
    dimensions: 1024,  // matches our pgvector(1024) column
    normalize: true,   // produce unit-length vectors — required for cosine
  };

  const command = new InvokeModelCommand({
    modelId: env.BEDROCK_EMBEDDING_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  // response.body is a Uint8Array — decode and parse.
  const payload = JSON.parse(new TextDecoder().decode(response.body));

  if (!Array.isArray(payload.embedding) || payload.embedding.length !== 1024) {
    throw new Error(
      `embedText: unexpected response shape (embedding length = ${payload.embedding?.length})`
    );
  }
  return payload.embedding; // number[1024]
}

// ---------------------------------------------------------------------------
// generateAnswer — ask Claude Haiku for a grounded answer
// ---------------------------------------------------------------------------
// Takes the user's question and the retrieved chunks, builds the prompt,
// and returns Claude's response text.
//
// The "answer only from context, otherwise out-of-expertise" behavior is
// enforced entirely by the system prompt below — no special model setting.
export async function generateAnswer({ question, contextChunks }) {
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

  const userMessage =
    `<context>\n${contextBlock}\n</context>\n\n` +
    `Question: ${question}`;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0,  // deterministic for factual Q&A — no creative drift
  };

  const command = new InvokeModelCommand({
    modelId: env.BEDROCK_GENERATION_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body));

  // Claude returns content as an array of blocks; we want the text from the
  // first block (there's normally only one for plain Q&A).
  const text = payload.content?.[0]?.text ?? '';

  return {
    text,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
  };
}
