import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { leadHistory } from '../../lib/activity.js';
import { env } from '../../config/env.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { reminderContext } from './service.js';

export const router = Router();
router.use('/reminders', requireStaff);
const uuid = z.string().uuid();

const SELECT = `
  SELECT r.*, u.name AS recipient_name, c.name AS created_by_name, t.label AS type_label,
         p.name AS project_name, l.name AS lead_name, m.title AS meeting_title
    FROM reminders r
    JOIN users u ON u.id=r.recipient_id JOIN users c ON c.id=r.created_by
    LEFT JOIN reminder_types t ON t.id=r.type_id
    LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN leads l ON l.id=r.lead_id LEFT JOIN meetings m ON m.id=r.meeting_id`;

router.get('/reminders', async (req, res) => {
  const me = currentUser(req);
  const meetingId = req.query.meetingId ? parse(uuid, req.query.meetingId) : null;
  const leadId = req.query.leadId ? parse(uuid, req.query.leadId) : null;
  const rows = meetingId
    ? await many(`${SELECT} WHERE r.meeting_id=$1 ORDER BY r.run_at DESC LIMIT 200`, [meetingId])
    : leadId
      ? await many(`${SELECT} WHERE r.lead_id=$1 ORDER BY r.run_at DESC LIMIT 200`, [leadId])
      : await many(`${SELECT} WHERE (r.created_by=$1 OR r.recipient_id=$1) AND NOT r.auto_notice ORDER BY r.run_at DESC LIMIT 500`, [me.id]);
  res.json(rows);
});

router.get('/reminders/recipients', async (req, res) => {
  const projectId = req.query.projectId ? parse(uuid, req.query.projectId) : null;
  res.json(
    await many(
      `SELECT id, name, email, role FROM users
        WHERE disabled_at IS NULL AND (role <> 'client' OR ($1::uuid IS NOT NULL AND id IN (SELECT user_id FROM project_access WHERE project_id=$1)))
        ORDER BY role='client', name`,
      [projectId],
    ),
  );
});

const fields = {
  recipientId: uuid,
  title: z.string().trim().min(1, 'Add a subject.').max(200),
  body: z.string().trim().max(5000).default(''),
  runAt: zs.datetime,
  typeId: uuid.nullish(),
};

async function validate(r: { run_at: Date; type_id?: string | null; channel: string }, target: Parameters<typeof reminderContext>[0]) {
  const t = r.run_at.getTime();
  if (t < Date.now() - 60_000 || t > Date.now() + 366 * 86_400_000) throw badRequest('Schedule within the next year.');
  if (r.channel === 'email' && !env.MAIL_ENABLED) throw conflict('Email sending is turned off. Use an in-app reminder instead.');
  if (r.type_id && !(await one('SELECT 1 FROM reminder_types WHERE id=$1', [r.type_id]))) throw badRequest('Choose an existing reminder type.');
  if (!(await reminderContext(target)))
    throw badRequest('Choose an active recipient with access to an unfinished, shared resource.');
}

router.post('/reminders', async (req, res) => {
  const me = currentUser(req);
  const body = parse(
    z
      .object({
        ...fields,
        id: uuid,
        projectId: uuid.nullish(),
        leadId: uuid.nullish(),
        meetingId: uuid.nullish(),
        channel: z.enum(['in_app', 'email']).default('in_app'),
      })
      .refine((b) => [b.projectId, b.leadId, b.meetingId].filter(Boolean).length === 1, 'Choose one lead, project or meeting.'),
    req.body,
  );
  const result = await transaction(async () => {
    const existing = await one('SELECT * FROM reminders WHERE id=$1', [body.id]);
    if (existing) {
      const same = existing.created_by === me.id && existing.title === body.title && existing.recipient_id === body.recipientId &&
        new Date(existing.run_at).getTime() === new Date(body.runAt).getTime();
      if (!same) throw conflict('This reminder was already saved with different details.');
      return { row: existing, created: false };
    }
    if (body.leadId) {
      const lead = await one('SELECT state FROM leads WHERE id=$1', [body.leadId]);
      if (!lead) throw notFound('Lead');
      if (lead.state === 'won') throw conflict('This lead has been handed off. Continue work in its linked project.');
    }
    if (body.meetingId && !(await one('SELECT 1 FROM meetings WHERE id=$1', [body.meetingId]))) throw notFound('Meeting');
    const target = { recipient_id: body.recipientId, created_by: me.id, project_id: body.projectId, lead_id: body.leadId, meeting_id: body.meetingId };
    await validate({ run_at: new Date(body.runAt), type_id: body.typeId, channel: body.channel }, target);
    const row = await one(
      `INSERT INTO reminders(id, created_by, recipient_id, project_id, lead_id, meeting_id, type_id, title, body, channel, run_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [body.id, me.id, body.recipientId, body.projectId ?? null, body.leadId ?? null, body.meetingId ?? null, body.typeId ?? null, body.title, body.body, body.channel, body.runAt],
    );
    if (body.leadId) await leadHistory(body.leadId, me.id, `Reminder scheduled: ${body.title}`);
    return { row: row!, created: true };
  });
  res.status(result.created ? 201 : 200).json(await one(`${SELECT} WHERE r.id=$1`, [result.row.id]));
});

async function mine(req: Parameters<typeof currentUser>[0], id: string) {
  const r = await one('SELECT * FROM reminders WHERE id=$1 FOR UPDATE', [id]);
  if (!r) throw notFound('Reminder');
  if (r.created_by !== currentUser(req).id) throw forbidden('Only the person who scheduled this reminder can change it.');
  return r;
}

router.patch('/reminders/:id', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object(fields).partial().refine((b) => Object.keys(b).length > 0, 'Nothing to change.'), req.body);
  const id = parse(uuid, req.params.id);
  await transaction(async () => {
    const r = await mine(req, id);
    if (!['pending', 'failed'].includes(r.status)) throw conflict('This reminder is already delivered or has finished.');
    const next = {
      recipient_id: body.recipientId ?? r.recipient_id,
      title: body.title ?? r.title,
      body: body.body ?? r.body,
      run_at: body.runAt ? new Date(body.runAt) : new Date(r.run_at),
      type_id: body.typeId !== undefined ? body.typeId : r.type_id,
    };
    await validate({ ...next, channel: r.channel }, { ...r, recipient_id: next.recipient_id } as never);
    await query(
      `UPDATE reminders SET recipient_id=$2, title=$3, body=$4, run_at=$5, type_id=$6, status='pending', attempts=0, last_error='', updated_at=now() WHERE id=$1`,
      [id, next.recipient_id, next.title, next.body, next.run_at, next.type_id ?? null],
    );
    if (r.lead_id) await leadHistory(r.lead_id, me.id, `Reminder updated: ${next.title}`);
  });
  res.json(await one(`${SELECT} WHERE r.id=$1`, [id]));
});

router.post('/reminders/:id/cancel', async (req, res) => {
  const me = currentUser(req);
  const id = parse(uuid, req.params.id);
  await transaction(async () => {
    const r = await mine(req, id);
    if (!['pending', 'failed', 'cancelled'].includes(r.status)) throw conflict('This reminder is already delivered.');
    if (r.status === 'cancelled') return;
    await query(`UPDATE reminders SET status='cancelled', updated_at=now() WHERE id=$1`, [id]);
    if (r.lead_id) await leadHistory(r.lead_id, me.id, `Reminder cancelled: ${r.title}`);
  });
  res.json(await one(`${SELECT} WHERE r.id=$1`, [id]));
});
