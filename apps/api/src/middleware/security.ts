import type { RequestHandler } from 'express';
import { HttpError } from '../lib/errors.js';
import { env } from '../config/env.js';

/** Fixed-window in-memory rate limiter keyed by IP and bucket. */
export function rateLimit(bucket: string, max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req, _res, next) => {
    const now = Date.now();
    const key = `${bucket}:${req.ip}`;
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    if (entry.count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', 'rate_limited');
    next();
  };
}

/** Rejects state-changing requests from foreign origins (CSRF defence alongside SameSite cookies). */
export const sameOrigin: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = new Set([new URL(env.APP_ORIGIN).origin, `http://${req.get('host')}`, `https://${req.get('host')}`]);
  if (!allowed.has(origin)) throw new HttpError(403, 'Cross-origin request blocked.', 'forbidden');
  next();
};
