import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { workspaceCurrency } from '../../lib/settings.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { invoiceViews } from '../invoices/service.js';

export const router = Router();
router.use(['/dashboard', '/today'], requireStaff);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.string().datetime({ offset: true });

function period(q: Record<string, unknown>, maxDays: number) {
  if (!q.from && !q.to) return null;
  const p = parse(z.object({ from: iso, to: iso, fromDay: day.optional(), toDay: day.optional() }), q);
  const span = (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000;
  if (span <= 0 || span > maxDays) throw badRequest(`Choose a period of up to ${maxDays} days.`);
  if (p.fromDay && p.toDay && p.fromDay > p.toDay) throw badRequest('The period ends before it starts.');
  return p;
}

/** Sum of open invoice balances in the workspace currency. */
export async function unpaidBalance(currency: string) {
  const views = await invoiceViews(`i.status NOT IN ('draft','void') AND i.currency=$1`, [currency]);
  return views.reduce((n, v) => n + Number(v.balance), 0);
}

router.get('/dashboard', async (req, res) => {
  const me = currentUser(req);
  const admin = me.role === 'admin';
  const p = period(req.query, 32);
  const currency = await workspaceCurrency();
  const [metrics, activity, tasks, meetings, leadCounts, recentLeads] = await Promise.all([
    one(
      `SELECT count(*)::int AS active_projects, COALESCE(sum(p.value) FILTER (WHERE p.currency=$3), 0)::bigint AS pipeline_value,
              (SELECT count(*)::int FROM tasks WHERE NOT completed AND ($1 OR assignee_id=$2)) AS open_tasks
         FROM projects p JOIN project_stages s ON s.id=p.stage
        WHERE p.phase <> 'intake' AND s.category NOT IN ('completed','archived')`,
      [admin, me.id, currency],
    ),
    many(
      `SELECT a.*, p.name AS project_name FROM activities a JOIN projects p ON p.id=a.project_id ORDER BY a.created_at DESC LIMIT 20`,
    ),
    many(
      `SELECT t.*, u.name AS assignee_name, l.name AS lead_name, p.name AS project_name FROM tasks t
         LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN projects p ON p.id=t.project_id
        WHERE NOT t.completed AND ($1 OR t.assignee_id=$2) ORDER BY t.due_date NULLS LAST, t.created_at LIMIT 12`,
      [admin, me.id],
    ),
    many(
      `SELECT m.id, m.title, m.kind, m.start_at, m.duration_minutes, m.meeting_url, m.location, m.source,
              COALESCE(p.name, l.name) AS target_name
         FROM meetings m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN leads l ON l.id=m.lead_id
        WHERE m.status <> 'cancelled' AND m.start_at >= now() ORDER BY m.start_at LIMIT 8`,
    ),
    one(
      `SELECT count(*)::int AS active,
              count(*) FILTER (WHERE stage = (SELECT id FROM lead_stages WHERE kind='open' ORDER BY position LIMIT 1))::int AS new
         FROM leads WHERE state='active'`,
    ),
    many(
      `SELECT l.id, l.name, l.data->>'company' AS company, s.label AS stage, l.created_at FROM leads l JOIN lead_stages s ON s.id=l.stage
        WHERE l.state='active' ORDER BY l.created_at DESC LIMIT 4`,
    ),
  ]);
  let periodStats: Record<string, number> | undefined;
  if (p) {
    const row = await one(
      `SELECT
         (SELECT count(*)::int FROM leads l LEFT JOIN lead_nurture n ON n.lead_id=l.id
           WHERE l.created_at >= $1 AND l.created_at < $2 AND COALESCE(n.source,'') <> 'imported') AS new_leads,
         (SELECT count(*)::int FROM projects WHERE phase <> 'intake' AND created_at >= $1 AND created_at < $2) AS new_projects,
         (SELECT count(*)::int FROM tasks WHERE NOT completed AND due_date BETWEEN $3::date AND $4::date AND ($5 OR assignee_id=$6)) AS tasks_due,
         (SELECT COALESCE(sum(pm.amount),0)::bigint FROM payments pm JOIN invoices i ON i.id=pm.invoice_id
           WHERE NOT pm.reversed AND i.currency=$7 AND pm.received_date >= $3::date AND pm.received_date <= $4::date) AS received`,
      [p.from, p.to, p.fromDay ?? p.from.slice(0, 10), p.toDay ?? p.to.slice(0, 10), admin, me.id, currency],
    );
    periodStats = { newLeads: row!.new_leads, newProjects: row!.new_projects, tasksDue: row!.tasks_due };
    if (admin) periodStats.received = Number(row!.received);
  }
  res.json({
    currency,
    metrics: {
      activeProjects: metrics!.active_projects,
      pipelineValue: Number(metrics!.pipeline_value),
      unpaidBalance: admin ? await unpaidBalance(currency) : undefined,
      openTasks: metrics!.open_tasks,
    },
    activity,
    tasks,
    meetings,
    leads: { active: leadCounts!.active, new: leadCounts!.new, recent: recentLeads },
    period: periodStats,
  });
});

const CALL_SELECT = `
  SELECT m.id, m.title, m.kind, m.start_at, m.duration_minutes, m.meeting_url, m.location, m.source, m.outcome,
         m.lead_id, m.project_id, COALESCE(p.name, l.name) AS target_name
    FROM meetings m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN leads l ON l.id=m.lead_id`;
const MINE = `(m.organizer_id=$1 OR l.data->>'ownerId' = $1::text
  OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.user_id=$1))`;

async function calls(userId: string, mine: boolean, from: string, to: string) {
  const scope = mine ? `AND ${MINE}` : '';
  const [today, upcoming, outcomePending] = await Promise.all([
    many(`${CALL_SELECT} WHERE m.status<>'cancelled' AND m.source<>'upload' AND m.start_at >= $2 AND m.start_at < $3 ${scope} ORDER BY m.start_at`, [userId, from, to]),
    many(
      `${CALL_SELECT} WHERE m.status<>'cancelled' AND m.source<>'upload' AND m.start_at >= $2 AND m.start_at < $2::timestamptz + interval '7 days' ${scope} ORDER BY m.start_at LIMIT 20`,
      [userId, to],
    ),
    many(
      `${CALL_SELECT} WHERE m.status<>'cancelled' AND m.source<>'upload' AND m.outcome IS NULL
         AND m.start_at + make_interval(mins => m.duration_minutes) < now() AND m.start_at > now() - interval '30 days' ${scope}
       ORDER BY m.start_at DESC LIMIT 20`,
      [userId],
    ),
  ]);
  return { today, upcoming, outcomePending };
}

router.get('/dashboard/calls', async (req, res) => {
  const me = currentUser(req);
  const p = period(req.query, 2);
  if (!p) throw badRequest('Choose a period.');
  res.json(await calls(me.id, req.query.scope !== 'team', p.from, p.to));
});

/** "My day": what the signed-in person should do today. */
router.get('/today', async (req, res) => {
  const me = currentUser(req);
  const p = period(req.query, 2);
  if (!p?.toDay) throw badRequest('Choose a day.');
  const [tasks, reminders, c, idle] = await Promise.all([
    many(
      `SELECT t.*, l.name AS lead_name, p.name AS project_name FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN projects p ON p.id=t.project_id
        WHERE t.assignee_id=$1 AND NOT t.completed AND t.due_date <= $2::date ORDER BY t.due_date, t.created_at LIMIT 100`,
      [me.id, p.toDay],
    ),
    many(
      `SELECT r.*, l.name AS lead_name, p.name AS project_name, m.title AS meeting_title FROM reminders r
         LEFT JOIN leads l ON l.id=r.lead_id LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN meetings m ON m.id=r.meeting_id
        WHERE r.recipient_id=$1 AND r.status IN ('pending','failed') AND r.run_at < $2 ORDER BY r.run_at LIMIT 100`,
      [me.id, p.to],
    ),
    calls(me.id, true, p.from, p.to),
    many(
      `SELECT l.id, l.name, l.data->>'company' AS company, s.label AS stage, l.updated_at FROM leads l JOIN lead_stages s ON s.id=l.stage
        WHERE l.state='active' AND l.data->>'ownerId' = $1::text
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id=l.id AND NOT t.completed)
          AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.status IN ('pending','failed')
                AND (r.lead_id=l.id OR r.meeting_id IN (SELECT id FROM meetings WHERE lead_id=l.id)))
          AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.lead_id=l.id AND m.status<>'cancelled' AND m.start_at > now())
        ORDER BY l.updated_at LIMIT 20`,
      [me.id],
    ),
  ]);
  res.json({ tasks, reminders, calls: c.today, outcomePending: c.outcomePending, leadsWithoutNextStep: idle });
});
