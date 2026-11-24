import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { env } from '../config/env.js';

const client = new BedrockRuntimeClient({
  region: env.AWS_REGION,
});

const MAX_EMBED_CHARS = 32_000;
const MAX_QUESTION_CHARS = 4_000;

export async function embedText(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string') {
    throw new Error('embedText: text must be a non-empty string');
  }
  if (text.length > MAX_EMBED_CHARS) {
    throw new Error(`embedText: input exceeds ${MAX_EMBED_CHARS} character limit`);
  }

  const body = {
    inputText: text,
    dimensions: 1024,
    normalize: true,
  };

  const command = new InvokeModelCommand({
    modelId: env.BEDROCK_EMBEDDING_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding: number[];
  };

  if (!Array.isArray(payload.embedding) || payload.embedding.length !== 1024) {
    throw new Error(
      `embedText: unexpected response shape (embedding length = ${payload.embedding?.length})`
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

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: `<context>\n${contextBlock}\n</context>\n\nQuestion: ${question}` }],
    temperature: 0,
  };

  const command = new InvokeModelCommand({
    modelId: env.BEDROCK_GENERATION_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    content?: { type: string; text: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    text: payload.content?.[0]?.text ?? '',
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
  };
}
