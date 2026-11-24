import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { createRateLimiter, userKey } from '../middleware/rateLimiter.js';
import { HttpError } from '../middleware/error.js';
import { query } from '../db/pool.js';
import { ingestDocument } from '../services/ingestion.js';
import { SUPPORTED_MIME_TYPES } from '../services/textExtractor.js';
import { matchesDeclaredType } from '../services/fileSignature.js';

const router = Router();

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  // First pass only: this can read the client's DECLARED mime type and
  // nothing else, because the bytes haven't arrived yet. The authoritative
  // check is the magic-byte verification in the handler below.
  fileFilter: (_req, file, cb) => {
    if (SUPPORTED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(415, `Unsupported file type: ${file.mimetype}`));
    }
  },
});

// 10 uploads per user per hour. Ingestion is the expensive path — one
// document fans out into hundreds of embedding calls — so this is a cost
// control as much as an abuse control. Keyed on userId (see rateLimiter.ts
// for why IP is the wrong key on an authenticated route); safe because this
// middleware is mounted after requireAuth.
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyPrefix: 'upload',
  keyGenerator: userKey,
});

const uuidSchema = z.string().uuid();

router.post(
  '/',
  requireAuth,
  uploadLimiter,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, 'No file uploaded (field name must be "file")');
      }
      if (!req.userId) {
        throw new HttpError(401, 'Unauthorized');
      }

      const { originalname, mimetype, size, buffer } = req.file;

      // Verify the bytes actually match the declared type before we write a
      // row or spend money on embeddings. multer's fileFilter only saw the
      // client's claim; this sees the content.
      if (!matchesDeclaredType(buffer, mimetype)) {
        throw new HttpError(415, 'File content does not match its declared type');
      }

      const insert = await query<{ id: string; created_at: string }>(
        `INSERT INTO documents (user_id, filename, mime_type, size_bytes, status)
         VALUES ($1, $2, $3, $4, 'processing')
         RETURNING id, created_at`,
        [req.userId, originalname, mimetype, size]
      );
      const documentId = insert.rows[0].id;

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
        // Log the real cause server-side, return a generic message to the
        // client. Parser errors from pdf-parse/mammoth can carry absolute
        // paths, library internals and version details — the same info-leak
        // class as echoing the request path in a 404.
        //
        // ingestDocument() has already written the detailed reason to the
        // document row, so the owner can still see it via GET /documents.
        console.error('[ingest] document %s failed:', documentId, ingestErr);

        res.status(422).json({
          id: documentId,
          filename: originalname,
          status: 'failed',
          error: 'Could not extract text from this document.',
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
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

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!req.userId) throw new HttpError(401, 'Unauthorized');
    const parsed = uuidSchema.safeParse(req.params['id']);
    if (!parsed.success) throw new HttpError(400, 'Invalid document id');

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
