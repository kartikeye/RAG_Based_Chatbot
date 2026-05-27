// src/routes/documents.js
//
// Document routes:
//   POST   /documents       — upload a file and ingest it
//   GET    /documents       — list the authenticated user's documents
//   DELETE /documents/:id   — delete a document (cascades to its chunks)
//
// All routes require auth (req.userId set by requireAuth middleware).

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { HttpError } from '../middleware/error.js';
import { query } from '../db/pool.js';
import { ingestDocument } from '../services/ingestion.js';
import { SUPPORTED_MIME_TYPES } from '../services/textExtractor.js';

const router = Router();

// ---------------------------------------------------------------------------
// Multer config — memory storage with a hard size cap.
// ---------------------------------------------------------------------------
// Memory storage means the file goes into RAM as a Buffer. For files up to
// a few MB this is fine. For larger files we'd switch to disk storage or
// stream uploads to S3.
//
// fileFilter rejects unsupported types BEFORE multer buffers them, saving
// memory on rejected requests.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (SUPPORTED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(415, `Unsupported file type: ${file.mimetype}`));
    }
  },
});

// 10 uploads per user per hour — embedding is expensive, throttle abuse.
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyPrefix: 'upload',
});

// Validate UUID-shaped path params (defense in depth — also prevents
// some classes of pathological inputs reaching the DB).
const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// POST /documents — upload + ingest
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  uploadLimiter,
  upload.single('file'),  // expects a multipart field named "file"
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, 'No file uploaded (field name must be "file")');
      }

      const { originalname, mimetype, size, buffer } = req.file;

      // 1. Create the documents row with status='processing' so the client
      //    has something to render immediately. We then run ingestion in the
      //    same request — when it returns, the status will be 'ready' or 'failed'.
      const insert = await query(
        `INSERT INTO documents (user_id, filename, mime_type, size_bytes, status)
         VALUES ($1, $2, $3, $4, 'processing')
         RETURNING id, created_at`,
        [req.userId, originalname, mimetype, size]
      );
      const documentId = insert.rows[0].id;

      // 2. Run ingestion. This calls Bedrock (slow) — request blocks until done.
      //    For production: return 202 Accepted now, push a job to a queue,
      //    process asynchronously, expose a GET /documents/:id status poll.
      try {
        const { chunkCount } = await ingestDocument({
          userId: req.userId,
          documentId,
          buffer,
          mimeType: mimetype,
        });

        res.status(201).json({
          id: documentId,
          filename: originalname,
          status: 'ready',
          chunkCount,
        });
      } catch (ingestErr) {
        // ingestDocument already updated the row to status='failed'.
        // Return 422 (Unprocessable Entity) — the upload succeeded but
        // processing failed.
        return res.status(422).json({
          id: documentId,
          filename: originalname,
          status: 'failed',
          error: ingestErr.message,
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /documents — list the user's documents
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, filename, mime_type, size_bytes, status, chunk_count,
              error_message, created_at, updated_at
       FROM documents
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.userId]
    );
    res.json({ documents: result.rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /documents/:id — delete a doc (chunks cascade via FK)
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const parsed = uuidSchema.safeParse(req.params.id);
    if (!parsed.success) throw new HttpError(400, 'Invalid document id');

    // Scope by user_id in the WHERE — prevents user A deleting user B's docs
    // even if they guess the UUID. ON DELETE CASCADE on chunks handles the
    // cleanup of the embedding rows.
    const result = await query(
      `DELETE FROM documents
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [parsed.data, req.userId]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'Document not found');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
