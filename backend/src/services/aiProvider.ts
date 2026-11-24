// src/services/aiProvider.ts
//
// Single switch point between embedding/generation backends. ingestion.ts
// and chat.ts import from here, never from bedrock.ts or ollama.ts directly,
// so swapping LLM_PROVIDER never touches either call site.
//
// Dynamic imports (not a static `import * as bedrock`) so selecting
// 'ollama' never constructs a BedrockRuntimeClient or touches AWS_REGION —
// bedrock.ts stays fully intact and ready for whenever an AWS account with
// Bedrock access is available again.

import { env } from '../config/env.js';
import type { GenerateAnswerParams, GenerateAnswerResult } from './bedrock.js';

async function loadProvider() {
  return env.LLM_PROVIDER === 'bedrock'
    ? import('./bedrock.js')
    : import('./ollama.js');
}

export async function embedText(text: string): Promise<number[]> {
  const provider = await loadProvider();
  return provider.embedText(text);
}

export async function generateAnswer(params: GenerateAnswerParams): Promise<GenerateAnswerResult> {
  const provider = await loadProvider();
  return provider.generateAnswer(params);
}
