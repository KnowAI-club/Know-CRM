import { Router } from 'express';
import { z } from 'zod';
import { MEETING_OUTCOME_LABELS } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { leadHistory, projectActivity } from '../../lib/activity.js';
import { notify, notifyMentions } from '../../lib/notify.js';
import { deleteObject, putObject } from '../../lib/storage.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { displayName, sendStored, upload } from '../files/routes.js';
import { dataSchema } from '../leads/service.js';
import { cancelReservationForMeeting } from '../booking/service.js';
import { KIND_LABELS, assertTarget, createMeeting, meetingFor, notificationList, setParticipants, syncNotices } from './service.js';

export const router = Router();
const uuid = z.string().uuid();
const idOf = (v: unknown) => parse(uuid, v);

const LIST_SELECT = `
  SELECT m.*, l.name AS lead_name, p.name AS project_name, u.name AS organizer_name,
    (SELECT count(*)::int FROM meeting_participants mp WHERE mp.meeting_id=m.id) AS participant_count`;

router.get('/meetings', async (req, res) => {
  const me = currentUser(req);
  if (me.role === 'client') {
    return void res.json(
      await many(
        `${LIST_SELECT} FROM meetings m LEFT JOIN leads l ON false LEFT JOIN projects p ON p.id=m.project_id JOIN users u ON u.id=m.organizer_id
          WHERE m.sharing='client' AND m.project_id IN (SELECT project_id FROM project_access WHERE user_id=$1)
            AND EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.user_id=$1)
          ORDER BY m.start_at DESC LIMIT 200`,
        [me.id],
      ),
    );
  }
  res.json(
    await many(
      `${LIST_SELECT}, (m.organizer_id=$1 OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.user_id=$1)) AS mine
         FROM meetings m LEFT JOIN leads l ON l.id=m.lead_id LEFT JOIN projects p ON p.id=m.project_id JOIN users u ON u.id=m.organizer_id
        ORDER BY m.start_at DESC LIMIT 1000`,
      [me.id],
    ),
  );
});

router.get('/meetings/guest-suggestions', requireStaff, async (req, res) => {
  const q = `%${String(req.query.q ?? '')
    .trim()
    .toLowerCase()
    .replace(/[%_\\]/g, '')}%`;
  res.json(
    await many(
      `SELECT email, max(name) AS name FROM (
         SELECT lower(email) AS email, name FROM contacts WHERE email <> ''
         UNION ALL SELECT lower(email), name FROM leads
         UNION ALL SELECT email, name FROM meeting_participants WHERE user_id IS NULL
       ) x
       WHERE (email LIKE $1 OR lower(name) LIKE $1) AND email NOT IN (SELECT lower(email) FROM users)
       GROUP BY email ORDER BY email LIMIT 8`,
      [q],
    ),
  );
});

const meetingFields = {
  title: z.string().trim().min(1, 'Add a title.').max(200),
  kind: z.enum(['video', 'phone', 'in_person']).default('video'),
  startAt: zs.datetime,
  durationMinutes: z.coerce.number().int().min(1).max(480),
  participantIds: z.array(uuid).max(50).default([]),
  externalEmails: z.array(zs.email).max(50).default([]),
  location: z.string().trim().max(500).default(''),
  meetingUrl: z.union([z.literal(''), z.string().trim().url('Enter a full meeting link.').max(1000)]).default(''),
  notifications: notificationList,
};

router.post('/meetings', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ ...meetingFields, projectId: uuid.nullish(), leadId: uuid.nullish() }), req.body);
  const meeting = await transaction(async () => {
    await assertTarget(body);
    return createMeeting(me, body);
  });
  res.status(201).json(meeting);
});

router.get('/meetings/:id', async (req, res) => {
  const me = currentUser(req);
  const m = await meetingFor(me, idOf(req.params.id));
  const participants = await many(
    `SELECT mp.email, mp.user_id, COALESCE(NULLIF(mp.name,''), u.name, mp.email) AS name, u.role
       FROM meeting_participants mp LEFT JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=$1 ORDER BY name`,
    [m.id],
  );
  const names = await one(
    `SELECT (SELECT name FROM leads WHERE id=$1) AS lead_name, (SELECT name FROM projects WHERE id=$2) AS project_name,
            (SELECT name FROM users WHERE id=$3) AS organizer_name`,
    [m.lead_id, m.project_id, m.organizer_id],
  );
  if (me.role === 'client') {
    const { outcome, outcome_reason, summary, decisions, transcript, notifications, ...rest } = m;
    return void res.json({ meeting: { ...rest, ...names }, participants: participants.filter((p) => p.user_id) });
  }
  res.json({ meeting: { ...m, ...names }, participants, ...(await recordView(m.id)) });
});

async function recordView(meetingId: string) {
  const [nextSteps, files] = await Promise.all([
    many(
      `SELECT s.*, u.name AS owner_name, t.completed AS task_completed FROM meeting_next_steps s
         LEFT JOIN users u ON u.id=s.owner_id LEFT JOIN tasks t ON t.id=s.task_id
        WHERE s.meeting_id=$1 ORDER BY s.position`,
      [meetingId],
    ),
    many('SELECT id, name, size, mime, created_at FROM meeting_files WHERE meeting_id=$1 ORDER BY created_at', [meetingId]),
  ]);
  return { nextSteps, files };
}

router.patch('/meetings/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object(meetingFields).partial(), req.body);
  const updated = await transaction(async () => {
    const m = await meetingFor(me, idOf(req.params.id), true);
    if (m.status === 'cancelled') throw conflict('This meeting is cancelled.');
    if (m.booking_reservation_id && (body.startAt || body.durationMinutes || body.externalEmails))
      throw conflict('Reschedule the booking to change its time or guests.');
    if (m.source === 'upload' && (body.startAt || body.durationMinutes)) throw conflict('Uploaded meetings keep their date.');
    const next = await one(
      `UPDATE meetings SET title=$2, kind=$3, start_at=$4, duration_minutes=$5, location=$6, meeting_url=$7, notifications=$8, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        m.id,
        body.title ?? m.title,
        body.kind ?? m.kind,
        body.startAt ?? m.start_at,
        body.durationMinutes ?? m.duration_minutes,
        body.location ?? m.location,
        body.meetingUrl ?? m.meeting_url,
        JSON.stringify(body.notifications ?? m.notifications),
      ],
    );
    if (body.participantIds || body.externalEmails) {
      const current = await many('SELECT email, user_id FROM meeting_participants WHERE meeting_id=$1', [m.id]);
      await setParticipants(
        m.id,
        m.organizer_id,
        m.project_id,
        body.participantIds ?? current.filter((p) => p.user_id).map((p) => p.user_id),
        body.externalEmails ?? current.filter((p) => !p.user_id).map((p) => p.email),
      );
    }
    await syncNotices(m.id);
    if (m.project_id) {
      const changes: string[] = [];
      if (body.title && body.title !== m.title) changes.push(`title “${m.title}” → “${body.title}”`);
      if (body.startAt && new Date(body.startAt).getTime() !== new Date(m.start_at).getTime())
        changes.push(`moved to [[at:${new Date(body.startAt).toISOString()}]]`);
      if (body.durationMinutes && body.durationMinutes !== m.duration_minutes)
        changes.push(`length ${m.duration_minutes} → ${body.durationMinutes} min`);
      if (body.location !== undefined && body.location !== m.location) changes.push(`location ${body.location || 'cleared'}`);
      if (changes.length) await projectActivity(me, m.project_id, `Meeting updated: ${next!.title} (${changes.join('; ')})`);
    }
    return next;
  });
  res.json(updated);
});

const recordSchema = z.object({
  outcome: z.enum(['attended', 'no_show', 'rescheduled', 'cancelled']).nullable().optional(),
  outcomeReason: z.string().trim().max(1000).optional(),
  summary: z.string().max(20000).optional(),
  decisions: z.string().max(20000).optional(),
  nextSteps: z
    .array(
      z.object({
        id: uuid.optional(),
        text: z.string().trim().min(1, 'Describe the next step.').max(500),
        ownerId: z.union([z.literal(''), uuid]).default(''),
        dueDate: zs.date,
      }),
    )
    .max(50)
    .optional(),
});

router.patch('/meetings/:id/record', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const body = parse(recordSchema, req.body);
  const id = idOf(req.params.id);
  await transaction(async () => {
    const m = await meetingFor(me, id, true);
    const outcome = body.outcome !== undefined ? body.outcome : m.outcome;
    const reason = body.outcomeReason ?? m.outcome_reason;
    if ((outcome === 'rescheduled' || outcome === 'cancelled') && !reason)
      throw badRequest('Add a reason for a rescheduled or cancelled meeting.');
    if (m.status === 'cancelled' && (body.outcome || body.nextSteps?.length))
      throw conflict('A cancelled meeting cannot take an outcome or next steps.');
    const steps = body.nextSteps;
    for (const s of steps ?? [])
      if (s.ownerId && !(await one(`SELECT 1 FROM users WHERE id=$1 AND role<>'client' AND disabled_at IS NULL`, [s.ownerId])))
        throw badRequest('Next-step owners must be active team members.');

    const before = [
      m.summary,
      m.decisions,
      ...(await many('SELECT text FROM meeting_next_steps WHERE meeting_id=$1', [id])).map((s) => s.text),
    ].join('\n');
    const outcomeChanged = outcome !== m.outcome;
    await query(
      `UPDATE meetings SET outcome=$2, outcome_reason=$3, summary=$4, decisions=$5,
         outcome_at = CASE WHEN $6 THEN (CASE WHEN $2::text IS NULL THEN NULL ELSE now() END) ELSE outcome_at END,
         outcome_by = CASE WHEN $6 THEN (CASE WHEN $2::text IS NULL THEN NULL ELSE $7::uuid END) ELSE outcome_by END,
         updated_at=now() WHERE id=$1`,
      [id, outcome, reason, body.summary ?? m.summary, body.decisions ?? m.decisions, outcomeChanged, me.id],
    );

    if (outcomeChanged && outcome && m.lead_id) {
      const lead = await one('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [m.lead_id]);
      if (lead && ['active', 'nurture'].includes(lead.state) && (outcome === 'attended' || outcome === 'no_show')) {
        const data = dataSchema.parse(lead.data ?? {});
        Object.assign(data, outcome === 'attended' ? { attendance: 'yes', outcome: 'ideal' } : { attendance: 'no', outcome: 'no_show' });
        await query('UPDATE leads SET data=$2, version=version+1, updated_at=now() WHERE id=$1', [lead.id, JSON.stringify(data)]);
      }
      if (lead)
        await leadHistory(m.lead_id, me.id, `Call outcome: ${MEETING_OUTCOME_LABELS[outcome] ?? outcome}`, { meetingId: id, reason });
    }
    if (outcome)
      await query(`UPDATE tasks SET completed=true, completed_at=now() WHERE kind='record_outcome' AND source_id=$1 AND NOT completed`, [
        id,
      ]);

    if (steps) {
      const existing = await many('SELECT * FROM meeting_next_steps WHERE meeting_id=$1', [id]);
      const keep = new Set(steps.filter((s) => s.id).map((s) => s.id));
      for (const old of existing) if (!keep.has(old.id)) await query('DELETE FROM meeting_next_steps WHERE id=$1', [old.id]);
      for (const [position, s] of steps.entries()) {
        const old = existing.find((e) => e.id === s.id);
        let taskId: string | null = old?.task_id ?? null;
        if (s.ownerId && s.dueDate) {
          if (taskId) {
            await query('UPDATE tasks SET title=$2, assignee_id=$3, due_date=$4 WHERE id=$1', [taskId, s.text, s.ownerId, s.dueDate]);
          } else {
            const task = await one(
              `INSERT INTO tasks(project_id, lead_id, title, due_date, assignee_id, visibility, created_by)
               VALUES($1,$2,$3,$4,$5,'internal',$6) RETURNING id`,
              [m.project_id, m.project_id ? null : m.lead_id, s.text, s.dueDate, s.ownerId, me.id],
            );
            taskId = task!.id;
            if (s.ownerId !== me.id)
              await notify({
                userId: s.ownerId,
                kind: 'task_assigned',
                title: 'A task was assigned to you',
                body: s.text,
                link: m.project_id ? `/projects/${m.project_id}?tab=tasks` : `/leads/${m.lead_id}?tab=tasks`,
              });
          }
        }
        if (old)
          await query('UPDATE meeting_next_steps SET text=$2, owner_id=$3, due_date=$4, task_id=$5, position=$6 WHERE id=$1', [
            old.id,
            s.text,
            s.ownerId || null,
            s.dueDate || null,
            taskId,
            position,
          ]);
        else
          await query('INSERT INTO meeting_next_steps(meeting_id, text, owner_id, due_date, task_id, position) VALUES($1,$2,$3,$4,$5,$6)', [
            id,
            s.text,
            s.ownerId || null,
            s.dueDate || null,
            taskId,
            position,
          ]);
      }
    }
    const after = [body.summary ?? m.summary, body.decisions ?? m.decisions, ...(steps ?? []).map((s) => s.text)].join('\n');
    await notifyMentions({ author: me, before, after, where: `the meeting ${m.title}`, link: `/meetings/${id}` });
  });
  res.json(await recordView(id));
});

router.patch('/meetings/:id/sharing', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { sharing } = parse(z.object({ sharing: z.enum(['internal', 'client']) }), req.body);
  const m = await meetingFor(me, idOf(req.params.id), true);
  if (sharing === 'client' && !m.project_id) throw conflict('Lead meetings stay internal until the lead becomes a project.');
  const row = await one('UPDATE meetings SET sharing=$2, updated_at=now() WHERE id=$1 RETURNING *', [m.id, sharing]);
  if (m.project_id && sharing !== m.sharing)
    await projectActivity(me, m.project_id, `Meeting ${sharing === 'client' ? 'shared with the client' : 'made internal'}: ${m.title}`);
  res.json(row);
});

router.post('/meetings/:id/cancel', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const row = await transaction(async () => {
    const m = await meetingFor(me, idOf(req.params.id), true);
    if (m.status === 'cancelled') throw conflict('This meeting is already cancelled.');
    if (new Date(m.start_at).getTime() <= Date.now()) throw conflict('This meeting has already started.');
    const next = await one(`UPDATE meetings SET status='cancelled', updated_at=now() WHERE id=$1 RETURNING *`, [m.id]);
    await syncNotices(m.id);
    if (m.booking_reservation_id) await cancelReservationForMeeting(m.booking_reservation_id);
    if (m.project_id) await projectActivity(me, m.project_id, `Meeting cancelled: ${m.title}`);
    return next;
  });
  res.json(row);
});

// ── Files (team only) ────────────────────────────────────────────────────────
router.post(
  '/meetings/:id/files',
  requireStaff,
  async (req, _res, next) => {
    await meetingFor(currentUser(req), idOf(req.params.id), true);
    next();
  },
  upload.single('file'),
  async (req, res) => {
    const me = currentUser(req);
    if (!req.file) throw badRequest('Choose a file to upload.');
    const key = await putObject('meetings', req.file.buffer);
    try {
      const file = await one(
        `INSERT INTO meeting_files(meeting_id, name, size, mime, storage_key, uploaded_by) VALUES($1,$2,$3,$4,$5,$6)
         RETURNING id, name, size, mime, created_at`,
        [req.params.id, displayName(req.file.originalname), req.file.size, req.file.mimetype || 'application/octet-stream', key, me.id],
      );
      res.status(201).json(file);
    } catch (e) {
      await deleteObject(key);
      throw e;
    }
  },
);

router.get('/meetings/:id/files/:fileId/download', requireStaff, async (req, res) => {
  const f = await one('SELECT * FROM meeting_files WHERE id=$1 AND meeting_id=$2', [idOf(req.params.fileId), idOf(req.params.id)]);
  if (!f) throw notFound('File');
  await sendStored(res, f.storage_key, f.name, Number(f.size));
});

router.delete('/meetings/:id/files/:fileId', requireStaff, async (req, res) => {
  const f = await one('DELETE FROM meeting_files WHERE id=$1 AND meeting_id=$2 RETURNING storage_key', [
    idOf(req.params.fileId),
    idOf(req.params.id),
  ]);
  if (!f) throw notFound('File');
  await deleteObject(f.storage_key);
  res.status(204).end();
});

// ── Past meetings recorded after the fact ───────────────────────────────────
const uploadSchema = z
  .object({
    title: z.string().trim().min(1, 'Add a title.').max(200),
    projectId: uuid.nullish(),
    leadId: uuid.nullish(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    participants: z.array(zs.email).max(50).default([]),
    summary: z.string().max(20000).default(''),
    transcript: z.string().max(500000).default(''),
    recordingUrl: z.union([z.literal(''), z.string().trim().url().max(1000)]).default(''),
  })
  .refine((b) => new Date(`${b.date}T12:00:00Z`).getTime() <= Date.now() + 86_400_000, { message: 'Choose a past date.', path: ['date'] })
  .refine((b) => b.summary.trim() || b.transcript.trim() || b.recordingUrl, {
    message: 'Add a summary, transcript or recording link.',
    path: ['summary'],
  });

router.post('/meetings/upload', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const body = parse(uploadSchema, req.body);
  const meeting = await transaction(async () => {
    await assertTarget(body);
    const users = await many(`SELECT id, email, role FROM users WHERE lower(email) = ANY($1::text[]) AND disabled_at IS NULL`, [
      body.participants,
    ]);
    const m = await createMeeting(me, {
      title: body.title,
      projectId: body.projectId,
      leadId: body.leadId,
      kind: 'video',
      startAt: `${body.date}T12:00:00Z`,
      durationMinutes: 60,
      meetingUrl: body.recordingUrl,
      participantIds: users.filter((u) => u.role !== 'client').map((u) => u.id),
      externalEmails: body.participants.filter((e) => !users.some((u) => u.email.toLowerCase() === e)),
      source: 'upload',
    });
    return one('UPDATE meetings SET summary=$2, transcript=$3 WHERE id=$1 RETURNING *', [m.id, body.summary, body.transcript]);
  });
  res.status(201).json(meeting);
});

router.delete('/meetings/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const m = await meetingFor(me, idOf(req.params.id), true);
  if (m.source !== 'upload') throw conflict('Cancel scheduled meetings instead of deleting them.');
  if (m.organizer_id !== me.id && me.role !== 'admin') throw conflict('Only the organizer or an admin can delete this meeting.');
  const files = await many('SELECT storage_key FROM meeting_files WHERE meeting_id=$1', [m.id]);
  await query('DELETE FROM meetings WHERE id=$1', [m.id]);
  for (const f of files) await deleteObject(f.storage_key);
  res.status(204).end();
});

export { KIND_LABELS };
