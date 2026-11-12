import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.', code: 'not_found' });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  // Multer and body-parser errors carry their own status.
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is too large.', code: 'file_too_large' });
    return;
  }
  if (status && status < 500) {
    res.status(status).json({ error: err.message || 'Bad request.', code: 'bad_request' });
    return;
  }
  // Postgres constraint violations.
  if (err?.code === '23505') {
    res.status(409).json({ error: 'A record with these details already exists.', code: 'conflict' });
    return;
  }
  if (err?.code === '23503') {
    res.status(409).json({ error: 'This record is linked to other records.', code: 'conflict' });
    return;
  }
  if (err?.code === '23514' || err?.code === '22P02') {
    res.status(400).json({ error: 'Invalid value.', code: 'bad_request' });
    return;
  }
  console.error(`[api] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal' });
};
