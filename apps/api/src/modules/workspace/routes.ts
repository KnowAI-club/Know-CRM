import { Router } from 'express';
import { z } from 'zod';
import { CURRENCIES, NOTIFICATION_KINDS } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { getSettings } from '../../lib/settings.js';
import { audit } from '../../lib/audit.js';
import { currentUser, requireAdmin, requireStaff } from '../../middleware/auth.js';
import { passwordSchema } from '../auth/routes.js';

export const router = Router();

/* ---------------- Team ---------------- */

router.get('/team', requireStaff, async (_req, res) => {
  res.json(
    await many(
      `SELECT id, name, email, role, phone, disabled_at IS NULL AS active, created_at
         FROM users WHERE role <> 'client' ORDER BY disabled_at IS NOT NULL, lower(name)`,
    ),
  );
});

router.get('/clients', requireAdmin, async (_req, res) => {
  res.json(
    await many(
      `SELECT id, name, email, disabled_at IS NULL AS active FROM users WHERE role='client' ORDER BY lower(name)`,
    ),
  );
});

router.post('/team', requireAdmin, async (req, res) => {
  const data = parse(
    z.object({
      name: zs.required(120),
      email: zs.email,
      password: passwordSchema,
      role: z.enum(['admin', 'sales', 'designer', 'developer']),
      phone: zs.optionalText(40),
    }),
    req.body,
  );
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [data.email]))
    throw conflict('An account with this email already exists.');
  const user = await one(
    `INSERT INTO users(name,email,role,password_hash,phone) VALUES($1,$2,$3,$4,$5)
     RETURNING id, name, email, role, phone, true AS active`,
    [data.name, data.email, data.role, await hashPassword(data.password), data.phone],
  );
  await audit(currentUser(req), 'user', user!.id, 'created', `Team member ${data.name} added as ${data.role}`);
  res.status(201).json(user);
});

router.patch('/team/:id', requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const data = parse(
    z.object({
      active: z.boolean().optional(),
      role: z.enum(['admin', 'sales', 'designer', 'developer']).optional(),
      name: zs.required(120).optional(),
    }),
    req.body,
  );
  const result = await transaction(async () => {
    await query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const target = await one(`SELECT * FROM users WHERE id=$1 AND role <> 'client'`, [id]);
    if (!target) throw notFound('Team member');
    const losingAdmin =
      target.role === 'admin' &&
      !target.disabled_at &&
      (data.active === false || (data.role && data.role !== 'admin'));
    if (losingAdmin) {
      if (id === me.id) throw conflict('You cannot remove your own administrator access.');
      const admins = await one<{ n: number }>(
        `SELECT count(*)::int n FROM users WHERE role='admin' AND disabled_at IS NULL`,
      );
      if ((admins?.n ?? 0) <= 1) throw conflict('Keep at least one active administrator.');
    }
    if (data.active === false && id === me.id) throw conflict('You cannot disable your own account.');
    if (data.active !== undefined && data.active === !target.disabled_at) delete data.active;
    await query(
      `UPDATE users SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         disabled_at = CASE WHEN $4::boolean IS NULL THEN disabled_at WHEN $4 THEN NULL ELSE now() END,
         disabled_by = CASE WHEN $4::boolean IS NULL THEN disabled_by WHEN $4 THEN NULL ELSE $5::uuid END
       WHERE id=$1`,
      [id, data.name ?? null, data.role ?? null, data.active ?? null, me.id],
    );
    if (data.active !== undefined || data.role) await query('DELETE FROM sessions WHERE user_id=$1', [id]);
    if (data.active !== undefined)
      await query('INSERT INTO security_events(user_id,event,ip) VALUES($1,$2,$3)', [
        me.id,
        `team_access_${data.active ? 'enabled' : 'disabled'}:${id}`,
        req.ip,
      ]);
    return one(
      `SELECT id, name, email, role, phone, disabled_at IS NULL AS active FROM users WHERE id=$1`,
      [id],
    );
  });
  await audit(me, 'user', id, 'updated', `Team member ${result!.name} updated`);
  res.json(result);
});

/* ---------------- Settings ---------------- */

const billingSchema = z.object({
  address: z.string().trim().max(1000).default(''),
  gstin: z.string().trim().toUpperCase().max(20).default(''),
  email: z.union([z.literal(''), zs.email]).default(''),
  phone: z.string().trim().max(50).default(''),
  bankAccountName: z.string().trim().max(200).default(''),
  bankName: z.string().trim().max(200).default(''),
  bankAccountNumber: z.string().trim().max(50).default(''),
  bankIfsc: z.string().trim().toUpperCase().max(20).default(''),
  bankAccountType: z.string().trim().max(100).default(''),
  terms: z.string().trim().max(3000).default(''),
});

router.get('/settings', requireStaff, async (_req, res) => {
  res.json(await getSettings());
});

router.patch('/settings', requireAdmin, async (req, res) => {
  const data = parse(
    z.object({
      name: zs.required(120).optional(),
      currency: z.enum(CURRENCIES).optional(),
      timezone: z.string().max(60).optional(),
      billing: billingSchema.optional(),
      defaultLeadOwnerId: z.union([z.literal(''), z.string().uuid()]).optional(),
      nurture: z
        .object({
          contactNumber: z.union([z.literal(''), z.string().trim().max(40).regex(/^[+\d][\d\s()-]*$/, 'Enter a valid phone number')]),
          bookingLink: z.union([z.literal(''), z.string().trim().url().max(300)]),
        })
        .partial()
        .optional(),
    }),
    req.body,
  );
  const current = await getSettings();
  if (!current) throw notFound('Workspace');
  if (data.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: data.timezone });
    } catch {
      throw badRequest('Choose a valid time zone.');
    }
  }
  if (data.currency && data.currency !== current.currency) {
    const used = await one('SELECT 1 FROM projects LIMIT 1');
    if (used) throw conflict('Currency cannot change after projects exist.');
  }
  if (data.defaultLeadOwnerId) {
    const ok = await one(`SELECT 1 FROM users WHERE id=$1 AND role<>'client' AND disabled_at IS NULL`, [
      data.defaultLeadOwnerId,
    ]);
    if (!ok) throw badRequest('Select an active team member as the default lead owner.');
  }
  const nextData = { ...current.data };
  if (data.billing) nextData.billing = data.billing;
  if (data.nurture) nextData.nurture = { ...(current.data.nurture ?? {}), ...data.nurture };
  if (data.defaultLeadOwnerId !== undefined) nextData.defaultLeadOwnerId = data.defaultLeadOwnerId;
  await query(
    `UPDATE workspace_settings SET name=$1, currency=$2, timezone=$3, data=$4, updated_at=now() WHERE id=1`,
    [data.name ?? current.name, data.currency ?? current.currency, data.timezone ?? current.timezone, nextData],
  );
  await audit(currentUser(req), 'settings', null, 'updated', 'Workspace settings updated');
  res.json(await getSettings());
});

router.get('/audit-log', requireAdmin, async (req, res) => {
  const { entity, entityId } = parse(
    z.object({ entity: z.string().max(40).optional(), entityId: z.string().uuid().optional() }),
    req.query,
  );
  res.json(
    await many(
      `SELECT * FROM audit_log WHERE ($1::text IS NULL OR entity=$1) AND ($2::uuid IS NULL OR entity_id=$2)
       ORDER BY created_at DESC LIMIT 200`,
      [entity ?? null, entityId ?? null],
    ),
  );
});

/* ---------------- Simple labelled lists: reminder types and file types ---------------- */

function labelledList(path: string, table: 'reminder_types' | 'file_types', usage: string, noun: string) {
  router.get(`/${path}`, requireStaff, async (_req, res) => {
    res.json(
      await many(
        `SELECT t.*, (${usage})::int AS usage_count FROM ${table} t ORDER BY position, lower(label)`,
      ),
    );
  });
  router.post(`/${path}`, requireAdmin, async (req, res) => {
    const { label } = parse(z.object({ label: zs.required(60) }), req.body);
    if (await one(`SELECT 1 FROM ${table} WHERE lower(label)=lower($1)`, [label]))
      throw conflict(`A ${noun} with this name already exists.`);
    const row = await one(
      `INSERT INTO ${table}(label, position) VALUES($1, COALESCE((SELECT max(position)+1 FROM ${table}),0)) RETURNING *, 0 AS usage_count`,
      [label],
    );
    res.status(201).json(row);
  });
  router.patch(`/${path}/:id`, requireAdmin, async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { label } = parse(z.object({ label: zs.required(60) }), req.body);
    if (await one(`SELECT 1 FROM ${table} WHERE lower(label)=lower($1) AND id<>$2`, [label, id]))
      throw conflict(`A ${noun} with this name already exists.`);
    const row = await one(`UPDATE ${table} SET label=$2 WHERE id=$1 RETURNING *`, [id, label]);
    if (!row) throw notFound(noun);
    res.json(row);
  });
  router.delete(`/${path}/:id`, requireAdmin, async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await transaction(async () => {
      await query(`LOCK TABLE ${table} IN EXCLUSIVE MODE`);
      const row = await one(`SELECT t.label, (${usage})::int AS n FROM ${table} t WHERE id=$1`, [id]);
      if (!row) throw notFound(noun);
      if (row.n > 0)
        throw conflict(`“${row.label}” is used by ${row.n} record(s). Rename it instead, or delete it once nothing uses it.`);
      const count = await one<{ n: number }>(`SELECT count(*)::int n FROM ${table}`);
      if ((count?.n ?? 0) <= 1) throw conflict(`Keep at least one ${noun}.`);
      await query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    });
    res.json({ ok: true });
  });
}
labelledList('reminder-types', 'reminder_types', 'SELECT count(*) FROM reminders r WHERE r.type_id=t.id', 'reminder type');
labelledList(
  'file-types',
  'file_types',
  'SELECT (SELECT count(*) FROM files f WHERE f.file_type_id=t.id) + (SELECT count(*) FROM lead_attachments a WHERE a.file_type_id=t.id)',
  'file type',
);

/* ---------------- Notifications ---------------- */

router.get('/notifications', async (req, res) => {
  const me = currentUser(req);
  const items = await many(
    `SELECT id, kind, title, body, link, read_at IS NOT NULL AS read, created_at
       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [me.id],
  );
  const unread = await one<{ n: number }>(
    'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL',
    [me.id],
  );
  res.json({ unread: unread?.n ?? 0, items });
});

router.post('/notifications/read', async (req, res) => {
  const me = currentUser(req);
  const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(100).optional() }), req.body);
  await query(
    `UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`,
    [me.id, ids ?? null],
  );
  res.json({ ok: true });
});

router.get('/notifications/preferences', async (req, res) => {
  const me = currentUser(req);
  const off = new Set(
    (await many('SELECT kind FROM notification_preferences WHERE user_id=$1 AND in_app=false', [me.id])).map(
      (r) => r.kind,
    ),
  );
  res.json(Object.entries(NOTIFICATION_KINDS).map(([kind, label]) => ({ kind, label, inApp: !off.has(kind) })));
});

router.put('/notifications/preferences/:kind', async (req, res) => {
  const me = currentUser(req);
  const { kind } = parse(z.object({ kind: z.enum(Object.keys(NOTIFICATION_KINDS) as [string, ...string[]]) }), req.params);
  const { inApp } = parse(z.object({ inApp: z.boolean() }), req.body);
  await query(
    `INSERT INTO notification_preferences(user_id,kind,in_app) VALUES($1,$2,$3)
     ON CONFLICT (user_id,kind) DO UPDATE SET in_app=EXCLUDED.in_app`,
    [me.id, kind, inApp],
  );
  res.json({ kind, inApp });
});

router.get('/jobs/status', requireAdmin, async (_req, res) => {
  res.json(await many('SELECT * FROM worker_runs ORDER BY job'));
});


