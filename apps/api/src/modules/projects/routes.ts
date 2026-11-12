import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { projectActivity } from '../../lib/activity.js';
import { workspaceCurrency } from '../../lib/settings.js';
import { assertActiveStaff } from '../../lib/users.js';
import { hashPassword } from '../../lib/password.js';
import { currentUser, requireAdmin, requireRole, requireStaff } from '../../middleware/auth.js';
import { passwordSchema } from '../auth/routes.js';
import { invoiceViewsForProject } from '../invoices/service.js';
import { PROJECT_SELECT, portalProject, projectFor } from './access.js';

export const router = Router();
const idParam = z.object({ id: z.string().uuid() });

const projectSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(500),
  contactId: z.string().uuid('Choose a client'),
  stage: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).default('inquiry'),
  value: z.coerce.number().int().min(0).max(1e11).default(0),
  description: z.string().max(20000).default(''),
  dueDate: zs.date,
  ownerId: z.string().uuid().optional(),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  projectType: z.string().trim().max(100).default(''),
  leadSource: z.string().trim().max(100).default(''),
  archiveReason: z.string().trim().max(500).default(''),
});

async function stageOf(id: string) {
  const s = await one('SELECT * FROM project_stages WHERE id=$1', [id]);
  if (!s) throw badRequest('Choose an existing pipeline stage.');
  return s;
}

export async function hydrateProject(id: string) {
  return one(`${PROJECT_SELECT} WHERE p.id=$1`, [id]);
}

/* ---------- Staff ---------- */

router.get('/projects', requireStaff, async (req, res) => {
  const me = currentUser(req);
  res.json(
    await many(
      `SELECT x.*, NOT EXISTS (SELECT 1 FROM project_reads r WHERE r.user_id=$1 AND r.project_id=x.id) AS unread
         FROM (${PROJECT_SELECT} WHERE p.phase <> 'intake') x ORDER BY x.created_at`,
      [me.id],
    ),
  );
});

router.post('/projects', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const data = parse(projectSchema, req.body);
  if (!(await one('SELECT 1 FROM contacts WHERE id=$1', [data.contactId]))) throw badRequest('Choose an existing contact.');
  const stage = await stageOf(data.stage);
  const ownerId = data.ownerId ?? me.id;
  await assertActiveStaff(ownerId, 'Owner must be a team member.');
  const project = await transaction(async () => {
    const p = await one(
      `INSERT INTO projects(name, contact_id, stage, value, currency, description, due_date, owner_id, progress,
                            project_type, lead_source, archive_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        data.name, data.contactId, data.stage, data.value, await workspaceCurrency(), data.description,
        data.dueDate || null, ownerId, data.progress, data.projectType, data.leadSource,
        stage.category === 'archived' ? data.archiveReason : '',
      ],
    );
    await projectActivity(me, p!.id, 'Project created');
    return p!;
  });
  res.status(201).json(await hydrateProject(project.id));
});

const FIELD_LABELS: [string, string, (v: any, p: any) => string][] = [
  ['name', 'Name', (v) => v],
  ['value', 'Value', (v, p) => `${(Number(v) / 100).toLocaleString('en-IN')} ${p.currency}`],
  ['due_date', 'Due date', (v) => v || 'none'],
  ['progress', 'Progress', (v) => `${v}%`],
  ['project_type', 'Project type', (v) => v || 'none'],
  ['lead_source', 'Lead source', (v) => v || 'none'],
  ['archive_reason', 'Archive reason', (v) => v || 'none'],
];

router.patch('/projects/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(projectSchema.partial(), req.body);
  for (const k of Object.keys(data)) if (!(k in req.body)) delete (data as any)[k];
  const current = await projectFor(req, id, true);
  if (data.contactId && !(await one('SELECT 1 FROM contacts WHERE id=$1', [data.contactId])))
    throw badRequest('Choose an existing contact.');
  if (data.ownerId) await assertActiveStaff(data.ownerId, 'Owner must be a team member.', current.owner_id);
  const stage = data.stage ? await stageOf(data.stage) : { id: current.stage, category: current.stage_category, label: current.stage_label };
  const next = {
    name: data.name ?? current.name,
    contact_id: data.contactId ?? current.contact_id,
    stage: stage.id,
    value: data.value ?? current.value,
    description: data.description ?? current.description,
    due_date: data.dueDate !== undefined ? data.dueDate || null : current.due_date,
    owner_id: data.ownerId ?? current.owner_id,
    progress: data.progress ?? current.progress,
    project_type: data.projectType ?? current.project_type,
    lead_source: data.leadSource ?? current.lead_source,
    archive_reason: stage.category === 'archived' ? (data.archiveReason ?? current.archive_reason) : '',
  };
  const stageChanged = stage.id !== current.stage;
  await transaction(async () => {
    await query(
      `UPDATE projects SET name=$2, contact_id=$3, stage=$4, value=$5, description=$6, due_date=$7, owner_id=$8,
         progress=$9, project_type=$10, lead_source=$11, archive_reason=$12, updated_at=now(),
         stage_changed_at = CASE WHEN $13 THEN now() ELSE stage_changed_at END
       WHERE id=$1`,
      [id, next.name, next.contact_id, next.stage, next.value, next.description, next.due_date, next.owner_id,
        next.progress, next.project_type, next.lead_source, next.archive_reason, stageChanged],
    );
    const edits: string[] = [];
    if (next.contact_id !== current.contact_id) {
      const c = await one('SELECT name FROM contacts WHERE id=$1', [next.contact_id]);
      edits.push(`Client changed to ${c?.name}`);
    }
    for (const [key, label, fmt] of FIELD_LABELS)
      if (String((next as any)[key] ?? '') !== String(current[key] ?? ''))
        edits.push(`${label} ${fmt(current[key], current)} → ${fmt((next as any)[key], current)}`);
    if (next.owner_id !== current.owner_id) {
      const o = await one('SELECT name FROM users WHERE id=$1', [next.owner_id]);
      edits.push(`Owner changed to ${o?.name ?? 'a former teammate'}`);
    }
    if (next.description !== current.description) edits.push('Description edited');
    if (stageChanged) await projectActivity(me, id, `Stage changed to ${stage.label}`, 'client');
    if (edits.length) await projectActivity(me, id, `Project details updated: ${edits.join('; ')}`);
  });
  res.json(await hydrateProject(id));
});

router.get('/projects/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  await query(
    `INSERT INTO project_reads(user_id, project_id) VALUES($1,$2) ON CONFLICT (user_id, project_id) DO UPDATE SET read_at=now()`,
    [me.id, id],
  );
  res.json(await projectDetail(req, id, false));
});

/* ---------- Portal ---------- */

router.get('/portal/projects', requireRole('client'), async (req, res) => {
  const me = currentUser(req);
  const rows = await many(
    `SELECT p.*, s.category AS stage_category, s.label AS stage_label, s.color AS stage_color
       FROM projects p JOIN project_stages s ON s.id=p.stage JOIN project_access a ON a.project_id=p.id
      WHERE a.user_id=$1 ORDER BY p.created_at DESC`,
    [me.id],
  );
  res.json(rows.map(portalProject));
});

router.get('/portal/projects/:id', requireRole('client'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await projectFor(req, id);
  res.json(await projectDetail(req, id, true));
});

async function projectDetail(req: any, id: string, portal: boolean) {
  const me = currentUser(req);
  const project = portal ? portalProject((await projectFor(req, id))!) : await hydrateProject(id);
  const vis = portal ? `AND visibility='client'` : '';
  const [tasks, notes, files, milestones, meetings, documents] = await Promise.all([
    many(
      `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
        WHERE t.project_id=$1 ${vis} ORDER BY t.completed, t.due_date NULLS LAST, t.created_at`,
      [id],
    ),
    many(`SELECT * FROM notes WHERE project_id=$1 ${vis} ORDER BY created_at DESC`, [id]),
    many(
      `SELECT f.id, f.name, f.size, f.mime, f.visibility, ${portal ? '' : 'f.to_share,'} f.file_type_id, ft.label AS file_type_label, f.created_at
         FROM files f LEFT JOIN file_types ft ON ft.id=f.file_type_id WHERE f.project_id=$1 ${portal ? `AND f.visibility='client'` : ''}
        ORDER BY f.created_at DESC`,
      [id],
    ),
    many('SELECT id, title, description, status, due_date, position FROM project_milestones WHERE project_id=$1 ORDER BY position', [id]),
    many(
      `SELECT m.id, m.title, m.kind, m.start_at, m.duration_minutes, m.status, m.location, m.meeting_url, m.sharing, m.outcome
         FROM meetings m WHERE m.project_id=$1 ${portal ? `AND m.sharing='client' AND m.status<>'cancelled'` : ''} ORDER BY m.start_at DESC`,
      [id],
    ),
    many(
      `SELECT id, title, kind, status, published_at, created_at, updated_at FROM documents WHERE project_id=$1 ${portal ? `AND status='published'` : ''}
        ORDER BY updated_at DESC`,
      [id],
    ),
  ]);
  const canSeeMessages = portal || me.role === 'admin';
  const messages = canSeeMessages
    ? await many('SELECT id, body, author_name, author_role, author_id, created_at FROM messages WHERE project_id=$1 ORDER BY created_at', [id])
    : [];
  const invoices = await invoiceViewsForProject(id, portal);
  if (portal) return { project, tasks, notes, files, milestones, meetings, documents, messages, invoices };
  const [activity, participants, contact, lead] = await Promise.all([
    many('SELECT * FROM activities WHERE project_id=$1 ORDER BY created_at DESC LIMIT 300', [id]),
    many(
      `SELECT u.id, u.name, u.email FROM project_access a JOIN users u ON u.id=a.user_id WHERE a.project_id=$1 ORDER BY u.name`,
      [id],
    ),
    one('SELECT c.* FROM contacts c JOIN projects p ON p.contact_id=c.id WHERE p.id=$1', [id]),
    one(
      `SELECT l.id, l.name, l.email, l.state, l.stage, l.data, l.created_at, w.won_at, s.label AS stage_label, u.name AS owner_name
         FROM leads l JOIN lead_stages s ON s.id=l.stage LEFT JOIN lead_won w ON w.lead_id=l.id
         LEFT JOIN users u ON u.id::text = l.data->>'ownerId'
        WHERE l.project_id=$1`,
      [id],
    ),
  ]);
  return {
    project, tasks, notes, files, milestones, meetings, documents, messages, invoices, activity, participants,
    clientInfo: { contact, lead },
  };
}

/* ---------- Client portal access ---------- */

router.post('/projects/:id/client-access', requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const project = await projectFor(req, id, true);
  const data = parse(z.object({ name: zs.optionalText(120), email: zs.email, password: passwordSchema }), req.body);
  const existing = await one('SELECT id, role FROM users WHERE lower(email)=$1', [data.email]);
  if (existing?.role && existing.role !== 'client') throw conflict('This email belongs to a team member.');
  if (existing) throw conflict('This client account already exists. Link the existing client instead.');
  const contact = await one('SELECT name FROM contacts WHERE id=$1', [project.contact_id]);
  const user = await transaction(async () => {
    const u = await one(
      `INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,'client',$3) RETURNING id, name, email, role`,
      [data.name || contact?.name || data.email, data.email, await hashPassword(data.password)],
    );
    await query('INSERT INTO project_access(user_id, project_id) VALUES($1,$2)', [u!.id, id]);
    await projectActivity(me, id, 'Client portal access granted');
    return u;
  });
  res.status(201).json({ user });
});

router.post('/projects/:id/client-links', requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  const { clientUserId } = parse(z.object({ clientUserId: z.string().uuid() }), req.body);
  const user = await one(`SELECT id, name, email, role FROM users WHERE id=$1 AND role='client'`, [clientUserId]);
  if (!user) throw badRequest('Choose an existing client account.');
  await query('INSERT INTO project_access(user_id, project_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [clientUserId, id]);
  await projectActivity(me, id, 'Existing client linked to portal');
  res.json({ user });
});

router.delete('/projects/:id/client-links/:userId', requireAdmin, async (req, res) => {
  const me = currentUser(req);
  const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
  await transaction(async () => {
    const r = await query('DELETE FROM project_access WHERE user_id=$1 AND project_id=$2', [userId, id]);
    if (!r.rowCount) throw notFound('Client access');
    await query(
      `UPDATE tasks SET assignee_id=NULL, visibility='internal' WHERE project_id=$1 AND assignee_id=$2`,
      [id, userId],
    );
    await projectActivity(me, id, 'Client portal access revoked');
  });
  res.json({ ok: true });
});

