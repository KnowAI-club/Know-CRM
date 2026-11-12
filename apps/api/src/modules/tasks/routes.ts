import { Router, type Request } from 'express';
import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { leadHistory, projectActivity } from '../../lib/activity.js';
import { notify } from '../../lib/notify.js';
import { currentUser, requireStaff, type SessionUser } from '../../middleware/auth.js';
import { projectFor } from '../projects/access.js';

export const router = Router();
const idParam = z.object({ id: z.string().uuid() });

const taskFields = z.object({
  title: z.string().trim().min(1, 'Required').max(500),
  dueDate: zs.date,
  assigneeId: z.union([z.literal(''), z.string().uuid()]).optional().default(''),
  visibility: z.enum(['internal', 'client']).default('internal'),
  urgent: z.boolean().default(false),
});

export const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name, l.name AS lead_name, p.name AS project_name
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
    LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN projects p ON p.id=t.project_id`;

/** Validates assignee/visibility rules for project and lead tasks. */
async function validateTask(
  data: { assigneeId?: string | null; visibility?: string },
  target: { projectId?: string | null; leadId?: string | null },
  previousAssignee?: string | null,
) {
  if (target.leadId && data.visibility === 'client') throw badRequest('Lead tasks stay internal to the team.');
  if (!data.assigneeId) return;
  const user = await one('SELECT id, role, disabled_at FROM users WHERE id=$1', [data.assigneeId]);
  if (!user) throw badRequest('Assignee does not exist.');
  if (user.disabled_at && data.assigneeId !== previousAssignee) throw badRequest('Choose an active assignee.');
  if (user.role === 'client') {
    if (target.leadId) throw badRequest('Lead tasks cannot be assigned to clients.');
    const access = await one('SELECT 1 FROM project_access WHERE user_id=$1 AND project_id=$2', [user.id, target.projectId]);
    if (data.visibility !== 'client' || !access)
      throw badRequest('Client tasks must be shared with a client who has project access.');
  }
}

async function notifyAssignee(actor: SessionUser, task: any, previous?: string | null) {
  if (!task.assignee_id || task.assignee_id === previous || task.assignee_id === actor.id) return;
  const user = await one('SELECT role FROM users WHERE id=$1', [task.assignee_id]);
  if (!user || user.role === 'client') return;
  await notify({
    userId: task.assignee_id,
    kind: 'task_assigned',
    title: `${actor.name} assigned you a task`,
    body: task.title,
    link: task.lead_id ? `/leads/${task.lead_id}` : `/projects/${task.project_id}?tab=tasks`,
  });
}

async function logTask(actor: SessionUser, task: any, text: string) {
  if (task.project_id) await projectActivity(actor, task.project_id, text);
  else await leadHistory(task.lead_id, actor.id, text);
}

export async function assertLeadOpen(leadId: string) {
  const lead = await one('SELECT state FROM leads WHERE id=$1', [leadId]);
  if (!lead) throw notFound('Lead');
  if (lead.state === 'won') throw conflict('This lead has been handed off. Continue work in its linked project.');
  return lead;
}

router.get('/tasks', requireStaff, async (req, res) => {
  const me = currentUser(req);
  res.json(
    await many(
      `${TASK_SELECT} WHERE ($1 OR t.assignee_id=$2) ORDER BY t.completed, t.due_date NULLS LAST, t.created_at DESC LIMIT 2000`,
      [me.role === 'admin', me.id],
    ),
  );
});

router.post('/projects/:id/tasks', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  const data = parse(taskFields, req.body);
  await validateTask(data, { projectId: id });
  const task = await one(
    `INSERT INTO tasks(project_id,title,due_date,assignee_id,visibility,urgent,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, data.title, data.dueDate || null, data.assigneeId || null, data.visibility, data.urgent, me.id],
  );
  const assignee = data.assigneeId ? await one('SELECT name FROM users WHERE id=$1', [data.assigneeId]) : null;
  await projectActivity(
    me,
    id,
    `Task added: ${data.title}${assignee ? `, assigned to ${assignee.name}` : ''}${data.dueDate ? `, due ${data.dueDate}` : ''}`,
  );
  await notifyAssignee(me, task);
  res.status(201).json(await one(`${TASK_SELECT} WHERE t.id=$1`, [task!.id]));
});

router.get('/leads/:id/tasks', requireStaff, async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(await many(`${TASK_SELECT} WHERE t.lead_id=$1 ORDER BY t.completed, t.due_date NULLS LAST, t.created_at`, [id]));
});

router.post('/leads/:id/tasks', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await assertLeadOpen(id);
  const data = parse(taskFields, req.body);
  await validateTask(data, { leadId: id });
  const task = await one(
    `INSERT INTO tasks(lead_id,title,due_date,assignee_id,visibility,urgent,created_by) VALUES($1,$2,$3,$4,'internal',$5,$6) RETURNING *`,
    [id, data.title, data.dueDate || null, data.assigneeId || null, data.urgent, me.id],
  );
  await leadHistory(id, me.id, `Task added: ${data.title}`);
  await notifyAssignee(me, task);
  res.status(201).json(await one(`${TASK_SELECT} WHERE t.id=$1`, [task!.id]));
});

async function findTask(req: Request, id: string) {
  const me = currentUser(req);
  const task = await one('SELECT * FROM tasks WHERE id=$1', [id]);
  if (!task) throw notFound('Task');
  if (task.lead_id && me.role === 'client') throw notFound('Task');
  if (task.project_id) await projectFor(req, task.project_id);
  return task;
}

router.patch('/tasks/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const task = await findTask(req, id);
  if (me.role === 'client') {
    if (task.visibility !== 'client' || task.assignee_id !== me.id)
      throw forbidden('Only your assigned shared tasks can be updated.');
    const { completed } = parse(z.object({ completed: z.boolean() }).strict(), req.body);
    await query(
      `UPDATE tasks SET completed=$2, completed_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1`,
      [id, completed],
    );
    await logTask(me, task, `Task ${completed ? 'completed' : 'reopened'}: ${task.title}`);
    return res.json(await one(`${TASK_SELECT} WHERE t.id=$1`, [id]));
  }
  if (task.lead_id) await assertLeadOpen(task.lead_id);
  const data = parse(taskFields.partial().extend({ completed: z.boolean().optional() }), req.body);
  for (const k of Object.keys(data)) if (!(k in req.body)) delete (data as any)[k];
  const next = {
    title: data.title ?? task.title,
    due_date: data.dueDate !== undefined ? data.dueDate || null : task.due_date,
    assignee_id: data.assigneeId !== undefined ? data.assigneeId || null : task.assignee_id,
    visibility: data.visibility ?? task.visibility,
    urgent: data.urgent ?? task.urgent,
    completed: data.completed ?? task.completed,
  };
  await validateTask(
    { assigneeId: next.assignee_id, visibility: next.visibility },
    { projectId: task.project_id, leadId: task.lead_id },
    task.assignee_id,
  );
  const updated = await one(
    `UPDATE tasks SET title=$2, due_date=$3, assignee_id=$4, visibility=$5, urgent=$6, completed=$7,
       completed_at = CASE WHEN $7 AND NOT completed THEN now() WHEN NOT $7 THEN NULL ELSE completed_at END
     WHERE id=$1 RETURNING *`,
    [id, next.title, next.due_date, next.assignee_id, next.visibility, next.urgent, next.completed],
  );
  const changes: string[] = [];
  if (next.title !== task.title) changes.push(`Title “${task.title}” → “${next.title}”`);
  if (String(next.due_date ?? '') !== String(task.due_date ?? '')) changes.push(`Due date ${task.due_date || 'none'} → ${next.due_date || 'none'}`);
  if (next.assignee_id !== task.assignee_id) {
    const u = next.assignee_id ? await one('SELECT name FROM users WHERE id=$1', [next.assignee_id]) : null;
    changes.push(`Assignee → ${u?.name ?? 'nobody'}`);
  }
  if (next.visibility !== task.visibility) changes.push(next.visibility === 'client' ? 'now shared' : 'now internal');
  if (next.urgent !== task.urgent) changes.push(`Urgent ${next.urgent ? 'yes' : 'no'}`);
  const verb = next.completed !== task.completed ? (next.completed ? 'completed' : 'reopened') : 'updated';
  if (verb !== 'updated' || changes.length)
    await logTask(me, task, `Task ${verb}: ${next.title}${changes.length ? ` (${changes.join('; ')})` : ''}`);
  await notifyAssignee(me, updated, task.assignee_id);
  res.json(await one(`${TASK_SELECT} WHERE t.id=$1`, [id]));
});

router.delete('/tasks/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const task = await findTask(req, id);
  await query('DELETE FROM tasks WHERE id=$1', [id]);
  await logTask(me, task, `Task deleted: ${task.title}`);
  res.json({ ok: true });
});
