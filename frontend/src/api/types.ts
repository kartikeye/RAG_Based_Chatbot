// src/api/types.ts
//
// Type definitions for the Express backend's request/response shapes.
// Hand-mirrored from backend/src/routes/*.ts. In a bigger project this would
// be a shared types package (or generated from an OpenAPI spec). For our
// scope, manual mirroring is faster and good enough.

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface DocumentRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'processing' | 'ready' | 'failed';
  chunk_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentsListResponse {
  documents: DocumentRow[];
}

export interface UploadSuccessResponse {
  id: string;
  filename: string;
  status: 'ready';
  chunkCount: number;
}

export interface UploadFailedResponse {
  id: string;
  filename: string;
  status: 'failed';
  error: string;
}

export type UploadResponse = UploadSuccessResponse | UploadFailedResponse;

export interface ChatSource {
  documentId: string;
  filename: string;
  chunkIndex: number;
  distance: number;
}

export interface ChatResponse {
  answer: string;
  grounded: boolean;
  sources: ChatSource[];
  usage: { inputTokens: number; outputTokens: number };
}
