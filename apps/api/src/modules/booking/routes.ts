import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { rateLimit } from '../../middleware/security.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import {
  assertSlot,
  bookingEvent,
  bookingTypeSchema,
  candidateSlots,
  onBookingChanged,
  onReservationCreated,
  type BookingType,
} from './service.js';

const uuid = z.string().uuid();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dateQuery = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const COLUMNS: Record<string, string> = {
  title: 'title', description: 'description', timezone: 'timezone', duration: 'duration', bufferBefore: 'buffer_before',
  bufferAfter: 'buffer_after', minimumNotice: 'minimum_notice', horizon: 'horizon', availability: 'availability',
  location: 'location', active: 'active',
};
const dbValue = (k: string, v: unknown) => (k === 'availability' ? JSON.stringify(v) : v);

// ── Staff: booking pages and reservations ────────────────────────────────────
export const router = Router();
router.use('/booking', requireStaff);

router.get('/booking/types', async (_req, res) => {
  res.json(
    await many(
      `SELECT t.*, u.name AS host_name,
         (SELECT count(*)::int FROM booking_reservations r WHERE r.booking_type_id=t.id AND r.status='confirmed' AND r.start_at > now()) AS upcoming
       FROM booking_types t JOIN users u ON u.id=t.host_id ORDER BY t.created_at DESC`,
    ),
  );
});

router.post('/booking/types', async (req, res) => {
  const me = currentUser(req);
  const data = parse(bookingTypeSchema, req.body);
  const keys = Object.keys(COLUMNS) as (keyof typeof data)[];
  const row = await one(
    `INSERT INTO booking_types(host_id, token, ${keys.map((k) => COLUMNS[k]).join(',')})
     VALUES($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')}) RETURNING *`,
    [me.id, randomBytes(24).toString('hex'), ...keys.map((k) => dbValue(k, data[k]))],
  );
  res.status(201).json(row);
});

async function ownType(req: Parameters<typeof currentUser>[0], id: string) {
  const me = currentUser(req);
  const t = await one('SELECT * FROM booking_types WHERE id=$1', [id]);
  if (!t) throw notFound('Booking page');
  if (t.host_id !== me.id && me.role !== 'admin') throw forbidden('Only the host or an admin can change this booking page.');
  return t;
}

router.patch('/booking/types/:id', async (req, res) => {
  const t = await ownType(req, parse(uuid, req.params.id));
  const data = parse(bookingTypeSchema.partial(), req.body);
  const keys = Object.keys(data).filter((k) => k in COLUMNS) as (keyof typeof data)[];
  if (!keys.length) return void res.json(t);
  const row = await transaction(async () => {
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking-host:${t.host_id}`]);
    return one(
      `UPDATE booking_types SET ${keys.map((k, i) => `${COLUMNS[k]}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`,
      [t.id, ...keys.map((k) => dbValue(k, data[k]))],
    );
  });
  res.json(row);
});

router.delete('/booking/types/:id', async (req, res) => {
  const t = await ownType(req, parse(uuid, req.params.id));
  if (await one('SELECT 1 FROM booking_reservations WHERE booking_type_id=$1 LIMIT 1', [t.id]))
    throw conflict('This page has bookings, so it is kept for their history. Turn it off instead.');
  await query('DELETE FROM booking_types WHERE id=$1', [t.id]);
  res.status(204).end();
});

router.get('/booking/reservations', async (_req, res) => {
  res.json(
    await many(
      `SELECT r.id, r.booking_type_id, r.host_id, r.name, r.email, r.start_at, r.end_at, r.status, r.created_at,
              t.title, t.timezone, t.location, u.name AS host_name, m.id AS meeting_id
         FROM booking_reservations r JOIN booking_types t ON t.id=r.booking_type_id JOIN users u ON u.id=r.host_id
         LEFT JOIN meetings m ON m.booking_reservation_id=r.id
        ORDER BY r.start_at DESC LIMIT 1000`,
    ),
  );
});

router.post('/booking/reservations/:id/cancel', async (req, res) => {
  const me = currentUser(req);
  const id = parse(uuid, req.params.id);
  const changed = await transaction(async () => {
    const r = await one('SELECT * FROM booking_reservations WHERE id=$1 FOR UPDATE', [id]);
    if (!r) throw notFound('Booking');
    if (r.host_id !== me.id && me.role !== 'admin') throw forbidden('Only the host or an admin can cancel this booking.');
    if (r.status === 'cancelled') return false;
    await query(`UPDATE booking_reservations SET status='cancelled', updated_at=now() WHERE id=$1`, [id]);
    await onBookingChanged(id);
    return true;
  });
  if (changed) await bookingEvent('cancelled', id, true);
  res.json({ ok: true });
});

// ── Public: booking page, slots, reserve, manage ─────────────────────────────
export const publicRouter = Router();
const publicLimit = rateLimit('public-booking', 60, 10 * 60_000);
const reserveLimit = rateLimit('public-booking-write', 10, 60 * 60_000);

const PUBLIC_FIELDS = 'id, token, title, description, timezone, duration, location, horizon, minimum_notice';

async function activeType(token: string) {
  const t = await one<BookingType & Record<string, any>>(
    `SELECT t.* FROM booking_types t JOIN users u ON u.id=t.host_id WHERE t.token=$1 AND t.active AND u.disabled_at IS NULL`,
    [token],
  );
  if (!t) throw notFound('This booking link is unavailable. Booking page');
  return t;
}
const tokenOf = (v: unknown) => parse(z.string().regex(/^[a-f0-9]{48}$/, 'Invalid link'), v);
const secretOf = (v: unknown) => parse(z.string().regex(/^[a-f0-9]{64}$/, 'Invalid link'), v);
const slotView = (s: { start: Date; end: Date }) => ({ startAt: s.start.toISOString(), endAt: s.end.toISOString() });

publicRouter.get('/public/booking/:token', publicLimit, async (req, res) => {
  const t = await activeType(tokenOf(req.params.token));
  const host = await one('SELECT name FROM users WHERE id=$1', [t.host_id]);
  const workspace = await one('SELECT name FROM workspace_settings WHERE id=1');
  res.json({ ...Object.fromEntries(PUBLIC_FIELDS.split(', ').map((k) => [k, t[k]])), host_name: host?.name, workspace: workspace?.name });
});

publicRouter.get('/public/booking/:token/slots', publicLimit, async (req, res) => {
  const t = await activeType(tokenOf(req.params.token));
  const date = parse(dateQuery, req.query.date);
  res.json((await candidateSlots(t, date)).map(slotView));
});

const reserveSchema = z
  .object({
    requestId: uuid,
    managementSecret: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1, 'Enter your name.').max(200),
    email: zs.email,
    startAt: zs.datetime,
    website: z.string().max(0).default(''), // honeypot
  })
  .strict();

publicRouter.post('/public/booking/:token/reservations', reserveLimit, async (req, res) => {
  const token = tokenOf(req.params.token);
  const body = parse(reserveSchema, req.body);
  const hash = sha(JSON.stringify({ ...body, managementSecret: undefined }));
  const { reservation, created } = await transaction(async () => {
    const t = await activeType(token);
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking-host:${t.host_id}`]);
    const replay = await one('SELECT * FROM booking_reservations WHERE request_id=$1', [body.requestId]);
    if (replay) {
      if (replay.request_hash !== hash) throw conflict('This request was already used for a different booking.');
      return { reservation: replay, created: false };
    }
    const start = new Date(body.startAt);
    await assertSlot(t, start);
    const end = new Date(start.getTime() + t.duration * 60_000);
    const r = await one(
      `INSERT INTO booking_reservations(booking_type_id, host_id, name, email, start_at, end_at, blocked_start, blocked_end,
         management_hash, request_id, request_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        t.id, t.host_id, body.name, body.email, start, end,
        new Date(start.getTime() - t.buffer_before * 60_000), new Date(end.getTime() + t.buffer_after * 60_000),
        sha(body.managementSecret), body.requestId, hash,
      ],
    );
    await onReservationCreated(t, r as { id: string; name: string; email: string; start_at: Date });
    return { reservation: r!, created: true };
  });
  if (created) await bookingEvent('created', reservation.id);
  res.status(created ? 201 : 200).json({
    reservation: publicReservation(reservation),
    managementPath: `/book/manage/${body.managementSecret}`,
  });
});

const publicReservation = (r: Record<string, any>) => ({
  id: r.id, name: r.name, email: r.email, start_at: r.start_at, end_at: r.end_at, status: r.status,
});

async function bySecret(secret: string) {
  const r = await one('SELECT * FROM booking_reservations WHERE management_hash=$1', [sha(secret)]);
  if (!r) throw notFound('Booking');
  const t = await one<BookingType & Record<string, any>>('SELECT * FROM booking_types WHERE id=$1', [r.booking_type_id]);
  return { r, t: t! };
}

publicRouter.get('/public/booking/manage/:secret', publicLimit, async (req, res) => {
  const { r, t } = await bySecret(secretOf(req.params.secret));
  res.json({ reservation: publicReservation(r), session: Object.fromEntries(PUBLIC_FIELDS.split(', ').map((k) => [k, t[k]])) });
});

publicRouter.get('/public/booking/manage/:secret/slots', publicLimit, async (req, res) => {
  const { r, t } = await bySecret(secretOf(req.params.secret));
  res.json((await candidateSlots(t, parse(dateQuery, req.query.date), { excludeReservationId: r.id })).map(slotView));
});

publicRouter.post('/public/booking/manage/:secret/cancel', reserveLimit, async (req, res) => {
  const secret = secretOf(req.params.secret);
  const changed = await transaction(async () => {
    const { r } = await bySecret(secret);
    await query('SELECT id FROM booking_reservations WHERE id=$1 FOR UPDATE', [r.id]);
    if (r.status === 'cancelled') return null;
    if (new Date(r.start_at).getTime() <= Date.now())
      throw conflict('This meeting has already started. Contact your host for changes.');
    await query(`UPDATE booking_reservations SET status='cancelled', updated_at=now() WHERE id=$1`, [r.id]);
    await onBookingChanged(r.id);
    return r.id as string;
  });
  if (changed) await bookingEvent('cancelled', changed);
  res.json({ ok: true });
});

publicRouter.post('/public/booking/manage/:secret/reschedule', reserveLimit, async (req, res) => {
  const secret = secretOf(req.params.secret);
  const { startAt } = parse(z.object({ startAt: zs.datetime, requestId: uuid.optional() }), req.body);
  const result = await transaction(async () => {
    const { r, t } = await bySecret(secret);
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking-host:${r.host_id}`]);
    if (r.status !== 'confirmed') throw conflict('This booking is cancelled.');
    if (new Date(r.start_at).getTime() <= Date.now())
      throw conflict('This meeting has already started. Contact your host for changes.');
    const start = new Date(startAt);
    if (start.getTime() === new Date(r.start_at).getTime()) return { r, changed: false };
    await assertSlot(t, start, r.id);
    const end = new Date(start.getTime() + t.duration * 60_000);
    const next = await one(
      `UPDATE booking_reservations SET start_at=$2, end_at=$3, blocked_start=$4, blocked_end=$5, updated_at=now() WHERE id=$1 RETURNING *`,
      [r.id, start, end, new Date(start.getTime() - t.buffer_before * 60_000), new Date(end.getTime() + t.buffer_after * 60_000)],
    );
    await onBookingChanged(r.id);
    return { r: next!, changed: true };
  });
  if (result.changed) await bookingEvent('rescheduled', result.r.id);
  res.json({ reservation: publicReservation(result.r) });
});

