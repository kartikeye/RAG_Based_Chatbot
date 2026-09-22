// src/services/fileSignature.ts
//
// Content-type verification by magic bytes.
//
// WHY: `req.file.mimetype` comes from the Content-Type header the CLIENT put
// in the multipart body. It is a claim, not a fact — anyone can label
// arbitrary bytes "application/pdf" with one line of curl. Multer's
// fileFilter can only see that claim, so it can only ever reject honest
// mistakes, never a deliberate one.
//
// So we check the claim against the file's actual leading bytes ("magic
// numbers") once the buffer is in hand. This is the same principle as
// `file(1)` on Unix: trust the content, not the label.
//
// Interview phrasing: "Never trust client-declared content types. Validate
// the magic bytes server-side and reject on mismatch — the MIME type in a
// multipart header is attacker-controlled input like any other."

/** Supported logical formats, keyed by the MIME type we accept for them. */
export type SupportedMime =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain'
  | 'text/markdown';

/** `%PDF-` — every PDF begins with this, per ISO 32000. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/**
 * `PK\x03\x04` — a .docx is a ZIP container (OOXML). We can't cheaply prove
 * it's specifically Word without unzipping, but rejecting non-ZIP bytes
 * removes the whole class of "arbitrary file renamed to .docx". mammoth
 * fails safely on a ZIP that isn't a Word document.
 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

/**
 * Plain text has no magic number, so we verify a negative instead: real text
 * does not contain NUL bytes. This is the heuristic `grep` uses to decide a
 * file is binary. We only sample the head — enough to catch a binary payload
 * wearing a text/plain label, cheap on a 10MB upload.
 */
function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return !sample.includes(0x00);
}

/**
 * Returns true when the buffer's actual content is consistent with the
 * declared MIME type. Callers should reject with 415 on false.
 */
export function matchesDeclaredType(buffer: Buffer, declaredMime: string): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;

  switch (declaredMime) {
    case 'application/pdf':
      return startsWith(buffer, PDF_MAGIC);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(buffer, ZIP_MAGIC);

    case 'text/plain':
    case 'text/markdown':
      return looksLikeText(buffer);

    default:
      // Unknown type — fileFilter should already have rejected it. Fail closed.
      return false;
  }
}
