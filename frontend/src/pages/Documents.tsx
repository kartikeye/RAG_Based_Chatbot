// src/pages/Documents.tsx
//
// File upload + list of the authenticated user's documents.
//
// Patterns demonstrated:
//   - Effect-driven fetching with useEffect (and a `mounted` guard for the
//     React 18 strict-mode double-invoke during dev).
//   - Re-fetch after mutating actions (upload, delete) rather than splicing
//     local state — simpler, always consistent with server.
//   - Drag-and-drop via the native HTML5 file API.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DocumentRow } from '../api/types';

const STATUS_STYLES: Record<DocumentRow['status'], string> = {
  processing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Documents() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listDocuments();
      setDocs(res.documents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await api.listDocuments().catch(() => null);
      if (mounted && res) setDocs(res.documents);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      // Upload sequentially to avoid hammering Bedrock during ingestion.
      for (const file of Array.from(files)) {
        await api.uploadDocument(file);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document and all its embedded chunks?')) return;
    setError(null);
    try {
      await api.deleteDocument(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Your documents</h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload PDFs, .docx, .txt, or .md. The chatbot will answer questions only from these.
        </p>
      </header>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'
        }`}
      >
        <p className="text-slate-700">
          {uploading ? 'Uploading and embedding… this can take 5–30 seconds.' : 'Drag files here or'}
        </p>
        {!uploading && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 rounded bg-indigo-600 text-white font-medium px-4 py-2 hover:bg-indigo-700"
            >
              Choose files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </>
        )}
      </div>

      <section>
        {loading ? (
          <p className="text-slate-500">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-slate-500">No documents yet — upload one to get started.</p>
        ) : (
          <ul className="divide-y divide-slate-200 bg-white rounded-xl shadow">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-slate-900 font-medium truncate">{d.filename}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(d.size_bytes)} · {d.chunk_count} chunks · {new Date(d.created_at).toLocaleString()}
                  </p>
                  {d.error_message && (
                    <p className="text-xs text-red-600 mt-1">{d.error_message}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${STATUS_STYLES[d.status]}`}>
                    {d.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(d.id)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
