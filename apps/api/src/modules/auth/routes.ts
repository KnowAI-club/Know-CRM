import { Router } from 'express';
import { z } from 'zod';
import { one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { conflict, unauthorized, badRequest } from '../../lib/errors.js';
import { hashPassword, verifyPassword, dummyHash } from '../../lib/password.js';
import { getSettings } from '../../lib/settings.js';
import { currentUser, endSession, requireAuth, startSession } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/security.js';

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(256, 'Use 256 characters or fewer');

const limiter = rateLimit('auth', 30, 15 * 60_000);
export const router = Router();

router.get('/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ status: 'ok' });
});

router.get('/auth/status', async (req, res) => {
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM users');
  res.json({ needsSetup: count?.n === 0, user: req.user ?? null, workspace: await getSettings() });
});

router.post('/setup', limiter, async (req, res) => {
  const data = parse(
    z.object({
      name: zs.required(120),
      email: zs.email,
      password: passwordSchema,
      workspaceName: zs.required(120),
      currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD']).default('INR'),
    }),
    req.body,
  );
  const hash = await hashPassword(data.password);
  const user = await transaction(async () => {
    await query('LOCK TABLE users IN EXCLUSIVE MODE');
    const existing = await one('SELECT 1 FROM users LIMIT 1');
    if (existing) throw conflict('The workspace has already been set up.');
    const u = await one<{ id: string }>(
      `INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,'admin',$3) RETURNING id`,
      [data.name, data.email, hash],
    );
    await query(
      `INSERT INTO workspace_settings(id,name,currency) VALUES(1,$1,$2)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, currency=EXCLUDED.currency`,
      [data.workspaceName, data.currency],
    );
    return u!;
  });
  await startSession(res, user.id);
  res.status(201).json({ ok: true });
});

router.post('/auth/login', limiter, async (req, res) => {
  const data = parse(z.object({ email: zs.email, password: z.string().max(256) }), req.body);
  const user = await one<{ id: string; password_hash: string; disabled_at: string | null }>(
    'SELECT id, password_hash, disabled_at FROM users WHERE lower(email)=$1',
    [data.email],
  );
  const ok = await verifyPassword(data.password, user?.password_hash ?? dummyHash);
  if (!user || !ok || user.disabled_at) {
    await query(`INSERT INTO security_events(user_id,event,ip) VALUES($1,'login_failed',$2)`, [
      user?.id ?? null,
      req.ip,
    ]);
    throw unauthorized('Incorrect email or password.');
  }
  await startSession(res, user.id);
  await query(`INSERT INTO security_events(user_id,event,ip) VALUES($1,'login',$2)`, [user.id, req.ip]);
  res.json({ ok: true });
});

router.post('/auth/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.post('/auth/password', requireAuth, limiter, async (req, res) => {
  const me = currentUser(req);
  const data = parse(
    z.object({ currentPassword: z.string().max(256), newPassword: passwordSchema }),
    req.body,
  );
  const stored = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [me.id]);
  if (!stored || !(await verifyPassword(data.currentPassword, stored.password_hash)))
    throw unauthorized('Current password is incorrect.');
  if (data.currentPassword === data.newPassword) throw badRequest('Choose a different new password.');
  const hash = await hashPassword(data.newPassword);
  await transaction(async () => {
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, me.id]);
    await query('DELETE FROM sessions WHERE user_id=$1', [me.id]);
    await query(`INSERT INTO security_events(user_id,event,ip) VALUES($1,'password_changed',$2)`, [me.id, req.ip]);
  });
  await startSession(res, me.id);
  res.json({ ok: true });
});
