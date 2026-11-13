import type { RequestHandler, Request, Response } from 'express';
import { one, query } from '../db/pool.js';
import { env } from '../config/env.js';
import { sha256, randomToken } from '../lib/password.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Role = 'admin' | 'sales' | 'designer' | 'developer' | 'client';
export const STAFF_ROLES: Role[] = ['admin', 'sales', 'designer', 'developer'];

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
}

export const SESSION_COOKIE = 'crm_session';

/** Attaches req.user when a valid session cookie is present. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 20) {
    const user = await one<SessionUser>(
      `SELECT u.id, u.name, u.email, u.role, u.phone
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [sha256(token)],
    );
    if (user) req.user = user;
  }
  next();
};

export async function startSession(res: Response, userId: string) {
  const token = randomToken();
  const days = env.SESSION_DAYS;
  await query('DELETE FROM sessions WHERE expires_at <= now()');
  await query(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1,$2, now() + make_interval(days => $3))`, [
    sha256(token),
    userId,
    days,
  ]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    maxAge: days * 86_400_000,
    path: '/',
  });
}

export async function endSession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') await query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

export const requireStaff = requireRole(...STAFF_ROLES);
export const requireAdmin = requireRole('admin');

export const isStaff = (user?: SessionUser) => !!user && STAFF_ROLES.includes(user.role);

/** Typed accessor for handlers that run after requireAuth. */
export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
