// src/services/textExtractor.js
//
// Given an uploaded file (Buffer + mime type), produce clean plain text.
// One function per supported format; one dispatch function on top.
//
// Why a separate service?
//   Routes should not know whether a file is a PDF or DOCX — they hand the
//   buffer over and get text back. This keeps file-format logic isolated
//   and makes adding a new format (e.g., .epub, .rtf) a one-file change.
//
// Limitations to call out in interviews:
//   - Scanned (image-only) PDFs return empty text. Real solution: OCR via
//     Tesseract or AWS Textract.
//   - PDFs with complex layouts (multi-column papers, tables) often lose
//     structure. Mitigation: layout-aware extractors like unstructured.io.

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// ---------------------------------------------------------------------------
// Supported MIME types — used by the upload route to reject unsupported files
// BEFORE we even buffer them into memory.
// ---------------------------------------------------------------------------
export const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
]);

// ---------------------------------------------------------------------------
// Top-level dispatch — routes call this.
// ---------------------------------------------------------------------------
export async function extractText({ buffer, mimeType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('extractText: buffer must be a non-empty Buffer');
  }

  let raw;
  switch (mimeType) {
    case 'application/pdf':
      raw = await extractFromPdf(buffer);
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      raw = await extractFromDocx(buffer);
      break;
    case 'text/plain':
    case 'text/markdown':
      raw = buffer.toString('utf8');
      break;
    default:
      throw new Error(`extractText: unsupported mime type "${mimeType}"`);
  }

  return cleanText(raw);
}

// ---------------------------------------------------------------------------
// Per-format extractors
// ---------------------------------------------------------------------------

async function extractFromPdf(buffer) {
  // pdf-parse returns { text, numpages, info, metadata, version }.
  // We only need `text`.
  const result = await pdfParse(buffer);
  return result.text ?? '';
}

async function extractFromDocx(buffer) {
  // mammoth.extractRawText returns { value, messages }.
  // `messages` contains warnings (unsupported elements) — we could log them
  // but we don't surface them to the user.
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

// ---------------------------------------------------------------------------
// Clean-up — strip control chars, normalize whitespace.
// ---------------------------------------------------------------------------
// Why bother?
//   1. PDF extraction often produces sequences of weird unicode (form-feed,
//      vertical tab, non-breaking spaces) that don't affect meaning but
//      bloat token counts and look ugly in citations.
//   2. Runs of blank lines inflate chunk boundaries weirdly.
//   3. Trailing whitespace is wasted bytes in embeddings (Titan tokenizes
//      whitespace).
function cleanText(text) {
  return text
    // Normalize line endings
    .replace(/\r\n?/g, '\n')
    // Strip ASCII control chars except newline (\n=0x0A) and tab (\x09)
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    // Replace non-breaking space and other Unicode whitespace with regular space
    .replace(/[  -​  　]/g, ' ')
    // Collapse runs of 3+ newlines into 2 (preserves paragraph breaks)
    .replace(/\n{3,}/g, '\n\n')
    // Collapse runs of spaces/tabs into a single space
    .replace(/[ \t]+/g, ' ')
    // Trim leading/trailing whitespace per line
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}
