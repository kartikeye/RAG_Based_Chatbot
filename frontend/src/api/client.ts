// src/api/client.ts
//
// Tiny typed fetch wrapper.
//
// Why not axios?
//   For ~5 endpoints, native fetch is plenty. We add (1) auth header injection
//   from localStorage, (2) JSON request/response handling, (3) typed errors
//   on non-2xx. axios is appropriate when you need interceptors or progress
//   callbacks at scale — not for this scope.
//
// Token storage:
//   We use localStorage for simplicity. Trade-off: any XSS in the app exposes
//   the token to the attacker. Production apps move to short-lived JWTs in
//   memory + a long-lived refresh token in an httpOnly cookie. Calling that
//   out as a known limitation is the right interview answer.

import type {
  AuthResponse,
  DocumentsListResponse,
  UploadResponse,
  ChatResponse,
} from './types';

const TOKEN_STORAGE_KEY = 'rag.token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Raw body (FormData) — used for file upload. JSON serialization is skipped. */
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData; // browser sets the multipart boundary header automatically
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });

  // Try to parse JSON; fall back to text. 204 No Content has no body.
  let payload: unknown = null;
  if (response.status !== 204) {
    const text = await response.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string')
        ? (payload as { error: string }).error
        : `Request failed with ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}

// ----- Public API surface (one function per endpoint) -----

export const api = {
  signup: (email: string, password: string) =>
    request<AuthResponse>('/auth/signup', { body: { email, password } }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { body: { email, password } }),

  listDocuments: () => request<DocumentsListResponse>('/documents'),

  uploadDocument: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<UploadResponse>('/documents', { method: 'POST', formData: fd });
  },

  deleteDocument: (id: string) =>
    request<null>(`/documents/${id}`, { method: 'DELETE' }),

  chat: (question: string) =>
    request<ChatResponse>('/chat', { body: { question } }),
};
