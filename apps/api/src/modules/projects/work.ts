import { Router } from 'express';
import { z } from 'zod';
import { mentionIds } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { projectActivity, snippet } from '../../lib/activity.js';
import { notifyMentions } from '../../lib/notify.js';
import { sendCsv, isoDay } from '../../lib/csv.js';
import { currentUser, requireAdmin, requireStaff } from '../../middleware/auth.js';
import { projectFor } from './access.js';

export const router = Router();
const idParam = z.object({ id: z.string().uuid() });
const visibility = z.enum(['internal', 'client']);

/* ---------- Milestones (client-visible project stages) ---------- */

const milestoneList = (projectId: string) =>
  many('SELECT id, title, description, status, due_date, position FROM project_milestones WHERE project_id=$1 ORDER BY position', [projectId]);

router.patch('/projects/:id/milestones/:milestoneId', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id, milestoneId } = parse(z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() }), req.params);
  const { status } = parse(z.object({ status: z.enum(['upcoming', 'in_progress', 'done']) }), req.body);
  await projectFor(req, id, true);
  await transaction(async () => {
    const m = await one('SELECT * FROM project_milestones WHERE id=$1 AND project_id=$2', [milestoneId, id]);
    if (!m) throw notFound('Stage');
    await query('UPDATE project_milestones SET status=$2, updated_at=now() WHERE id=$1', [milestoneId, status]);
    // Stages complete in order: finishing one finishes earlier ones; reopening reopens later ones.
    const cascade =
      status === 'done'
        ? await many(
            `UPDATE project_milestones SET status='done', updated_at=now() WHERE project_id=$1 AND position<$2 AND status<>'done' RETURNING title`,
            [id, m.position],
          )
        : await many(
            `UPDATE project_milestones SET status='upcoming', updated_at=now() WHERE project_id=$1 AND position>$2 AND status='done' RETURNING title`,
            [id, m.position],
          );
    const extra = cascade.length
      ? ` (also ${status === 'done' ? 'done' : 'reopened'}: ${cascade.map((c) => c.title).join(', ')})`
      : '';
    await projectActivity(me, id, `Stage ${m.title} marked ${status === 'done' ? 'done' : 'not done'}${extra}`, 'client');
  });
  res.json(await milestoneList(id));
});

router.put('/projects/:id/milestones', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  const { milestones } = parse(
    z.object({
      milestones: z
        .array(
          z.object({
            id: z.string().uuid().optional(),
            title: z.string().trim().min(1, 'Give every stage a name.').max(200),
            description: z.string().trim().max(2000).default(''),
            status: z.enum(['upcoming', 'in_progress', 'done']).default('upcoming'),
            dueDate: zs.date,
          }),
        )
        .max(30, 'Use 30 stages or fewer.'),
    }),
    req.body,
  );
  const lastDone = milestones.map((m) => m.status).lastIndexOf('done');
  milestones.forEach((m, i) => {
    if (i < lastDone) m.status = 'done';
  });
  await transaction(async () => {
    const keep = milestones.filter((m) => m.id).map((m) => m.id);
    await query('DELETE FROM project_milestones WHERE project_id=$1 AND NOT (id = ANY($2::uuid[]))', [id, keep]);
    await query('UPDATE project_milestones SET position = position + 1000 WHERE project_id=$1', [id]);
    for (const [i, m] of milestones.entries()) {
      const updated = m.id
        ? await query(
            `UPDATE project_milestones SET title=$3, description=$4, status=$5, due_date=$6, position=$7, updated_at=now()
              WHERE id=$1 AND project_id=$2`,
            [m.id, id, m.title, m.description, m.status, m.dueDate || null, i],
          )
        : null;
      if (!updated?.rowCount)
        await query(
          `INSERT INTO project_milestones(project_id,title,description,status,due_date,position) VALUES($1,$2,$3,$4,$5,$6)`,
          [id, m.title, m.description, m.status, m.dueDate || null, i],
        );
    }
    const titles = milestones.map((m) => m.title);
    await projectActivity(
      me,
      id,
      titles.length
        ? `Project stages updated: ${titles.slice(0, 6).join(', ')}${titles.length > 6 ? ` and ${titles.length - 6} more` : ''}`
        : 'Project stages cleared',
      'client',
    );
  });
  res.json(await milestoneList(id));
});

/* ---------- Versions (team-only delivery links) ---------- */

router.get('/projects/:id/versions', requireStaff, async (req, res) => {
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  res.json(
    await many(
      `SELECT v.*, u.name AS author_name FROM project_versions v LEFT JOIN users u ON u.id=v.created_by
        WHERE v.project_id=$1 AND v.removed_at IS NULL ORDER BY number DESC`,
      [id],
    ),
  );
});

router.post('/projects/:id/versions', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(
    z.object({
      url: z
        .string()
        .trim()
        .url('Enter a full link, starting with https://')
        .max(2000)
        .refine((u) => /^https?:\/\//.test(u), 'Use an http:// or https:// link.'),
      description: z.string().trim().max(2000).default(''),
    }),
    req.body,
  );
  await projectFor(req, id, true);
  const version = await transaction(async () => {
    await query('SELECT 1 FROM projects WHERE id=$1 FOR UPDATE', [id]);
    const v = await one(
      `INSERT INTO project_versions(project_id, number, url, description, created_by)
       VALUES($1, (SELECT COALESCE(max(number),0)+1 FROM project_versions WHERE project_id=$1), $2, $3, $4) RETURNING *`,
      [id, data.url, data.description, me.id],
    );
    await projectActivity(me, id, `Version v${v!.number} added`);
    return { ...v, author_name: me.name };
  });
  res.status(201).json(version);
});

router.delete('/projects/:id/versions/:versionId', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id, versionId } = parse(z.object({ id: z.string().uuid(), versionId: z.string().uuid() }), req.params);
  const v = await one('SELECT * FROM project_versions WHERE id=$1 AND project_id=$2 AND removed_at IS NULL', [versionId, id]);
  if (!v) throw notFound('Version');
  if (me.role !== 'admin' && v.created_by !== me.id)
    throw forbidden('Only the person who added this version or an admin can remove it.');
  await query('UPDATE project_versions SET removed_at=now() WHERE id=$1', [versionId]);
  await projectActivity(me, id, `Version v${v.number} removed`);
  res.json({ ok: true });
});

/* ---------- Notes ---------- */

function assertShareable(body: string, vis: string) {
  if (vis === 'client' && mentionIds(body).length)
    throw badRequest('Remove @mentions before sharing this note with the client.');
}

router.post('/projects/:id/notes', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  const data = parse(z.object({ body: z.string().trim().min(1).max(20000), visibility }), req.body);
  assertShareable(data.body, data.visibility);
  const note = await one(
    'INSERT INTO notes(project_id, body, visibility, author_id, author_name) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [id, data.body, data.visibility, me.id, me.name],
  );
  await projectActivity(me, id, `${data.visibility === 'client' ? 'Shared' : 'Internal'} note added: ${snippet(data.body)}`);
  await notifyMentions({ author: me, after: data.body, where: 'a project note', link: `/projects/${id}?tab=notes` });
  res.status(201).json(note);
});

router.patch('/notes/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(z.object({ body: z.string().trim().min(1).max(20000).optional(), visibility: visibility.optional() }), req.body);
  const note = await one('SELECT * FROM notes WHERE id=$1', [id]);
  if (!note) throw notFound('Note');
  const body = data.body ?? note.body;
  const vis = data.visibility ?? note.visibility;
  assertShareable(body, vis);
  const updated = await one('UPDATE notes SET body=$2, visibility=$3, updated_at=now() WHERE id=$1 RETURNING *', [id, body, vis]);
  const change = vis !== note.visibility ? (vis === 'client' ? ' (now shared with the client)' : ' (now internal)') : '';
  await projectActivity(me, note.project_id, `Note updated: ${snippet(body)}${change}`);
  await notifyMentions({ author: me, before: note.body, after: body, where: 'a project note', link: `/projects/${note.project_id}?tab=notes` });
  res.json(updated);
});

router.delete('/notes/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const note = await one('DELETE FROM notes WHERE id=$1 RETURNING *', [id]);
  if (!note) throw notFound('Note');
  await projectActivity(me, note.project_id, `Note deleted: ${snippet(note.body)}`);
  res.json({ ok: true });
});

/* ---------- Messages (admin ↔ client conversation) ---------- */

router.get('/messages', requireAdmin, async (_req, res) => {
  res.json(
    await many(
      `SELECT p.id AS project_id, p.name AS project_name, c.name AS contact_name, s.category AS stage_category,
              m.body AS last_body, m.author_name AS last_author, m.created_at AS last_at,
              (SELECT count(*)::int FROM messages mm WHERE mm.project_id=p.id) AS message_count
         FROM projects p JOIN contacts c ON c.id=p.contact_id JOIN project_stages s ON s.id=p.stage
         LEFT JOIN LATERAL (SELECT * FROM messages m WHERE m.project_id=p.id ORDER BY created_at DESC LIMIT 1) m ON true
        WHERE p.phase='delivery' AND s.category <> 'archived'
        ORDER BY m.created_at DESC NULLS LAST, p.name`,
    ),
  );
});

router.get('/projects/:id/messages', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  if (me.role !== 'admin' && me.role !== 'client') throw forbidden('Only workspace admins can see client messages.');
  await projectFor(req, id);
  res.json(await many('SELECT * FROM messages WHERE project_id=$1 ORDER BY created_at', [id]));
});

router.post('/projects/:id/messages', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  if (me.role !== 'admin' && me.role !== 'client') throw forbidden('Only workspace admins can message clients.');
  await projectFor(req, id);
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(20000) }), req.body);
  const msg = await one(
    'INSERT INTO messages(project_id, body, author_id, author_name, author_role) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [id, body, me.id, me.name, me.role],
  );
  await projectActivity(me, id, `Portal message posted: ${snippet(body)}`);
  res.status(201).json(msg);
});

/* ---------- Time tracking (internal) ---------- */

router.get('/projects/:id/time-entries', requireStaff, async (req, res) => {
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  res.json(
    await many(
      `SELECT t.*, u.name AS user_name FROM time_entries t JOIN users u ON u.id=t.user_id
        WHERE t.project_id=$1 ORDER BY work_date DESC, created_at DESC`,
      [id],
    ),
  );
});

router.post('/projects/:id/time-entries', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  const data = parse(
    z.object({
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      minutes: z.coerce.number().int().min(1).max(1440),
      description: z.string().trim().max(1000).default(''),
      billable: z.boolean().default(true),
    }),
    req.body,
  );
  if (data.workDate > isoDay(new Date(Date.now() + 86_400_000))) throw badRequest('Time can only be logged for today or earlier.');
  const entry = await one(
    'INSERT INTO time_entries(project_id,user_id,work_date,minutes,description,billable) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, me.id, data.workDate, data.minutes, data.description, data.billable],
  );
  const h = Math.floor(data.minutes / 60);
  const m = data.minutes % 60;
  await projectActivity(
    me,
    id,
    `Time logged: ${h}h ${m}m on ${data.workDate}${data.description ? ` for ${snippet(data.description)}` : ''}${data.billable ? '' : ' (not billable)'}`,
  );
  res.status(201).json({ ...entry, user_name: me.name });
});

router.delete('/time-entries/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const entry = await one('SELECT * FROM time_entries WHERE id=$1', [id]);
  if (!entry) throw notFound('Time entry');
  if (entry.user_id !== me.id && me.role !== 'admin') throw forbidden('Only the person who logged this time or an admin can remove it.');
  await query('DELETE FROM time_entries WHERE id=$1', [id]);
  res.json({ ok: true });
});

router.get('/exports/time.csv', requireAdmin, async (_req, res) => {
  const rows = await many(
    `SELECT t.work_date, p.name AS project, u.name AS member, t.minutes, t.billable, t.description
       FROM time_entries t JOIN projects p ON p.id=t.project_id JOIN users u ON u.id=t.user_id ORDER BY t.work_date DESC`,
  );
  sendCsv(
    res,
    `time-${isoDay()}.csv`,
    ['Date', 'Project', 'Team member', 'Hours', 'Billable', 'Description'],
    rows.map((r) => [r.work_date, r.project, r.member, (r.minutes / 60).toFixed(2), r.billable ? 'yes' : 'no', r.description]),
  );
});
