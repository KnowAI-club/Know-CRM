import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { workspaceCurrency } from '../../lib/settings.js';
import { sendCsv, isoDay, minorToDecimal } from '../../lib/csv.js';
import { requireStaff } from '../../middleware/auth.js';
import { invoiceViews } from '../invoices/service.js';

export const router = Router();
router.use('/reports', requireStaff);
const DAY = 86_400_000;

/** Days each lead spent in each stage, rebuilt from its stage-move history. */
router.get('/reports/lead-stage-days', async (_req, res) => {
  const leads = await many('SELECT id, stage, state, created_at FROM leads');
  const moves = await many(
    `SELECT lead_id, detail->>'previousStage' AS prev, detail->>'stage' AS stage, created_at FROM lead_history
      WHERE detail ? 'stage' AND detail->>'stage' IS DISTINCT FROM detail->>'previousStage' ORDER BY created_at`,
  );
  const byLead = new Map<string, typeof moves>();
  for (const m of moves) byLead.set(m.lead_id, [...(byLead.get(m.lead_id) ?? []), m]);
  const out: { leadId: string; stage: string; days: number }[] = [];
  for (const l of leads) {
    const list = byLead.get(l.id) ?? [];
    let stage: string = list[0]?.prev ?? l.stage;
    let since = new Date(l.created_at).getTime();
    for (const m of list) {
      const at = new Date(m.created_at).getTime();
      out.push({ leadId: l.id, stage, days: (at - since) / DAY });
      stage = m.stage;
      since = at;
    }
    if (l.state === 'active') out.push({ leadId: l.id, stage, days: (Date.now() - since) / DAY });
  }
  res.json(out);
});

/** Per lead: every stage it reached, and its booked / attended / no-show call counts. */
router.get('/reports/lead-facts', async (_req, res) => {
  res.json(
    await many(
      `SELECT l.id AS lead_id,
         ARRAY(SELECT DISTINCT s FROM (
           SELECT l.stage AS s
           UNION SELECT h.detail->>'stage' FROM lead_history h WHERE h.lead_id=l.id AND h.detail ? 'stage'
           UNION SELECT h.detail->>'previousStage' FROM lead_history h WHERE h.lead_id=l.id AND h.detail ? 'previousStage'
         ) x WHERE s IS NOT NULL) AS reached,
         (SELECT count(*)::int FROM meetings m WHERE m.lead_id=l.id AND (m.status<>'cancelled' OR m.outcome IN ('attended','no_show'))) AS booked,
         (SELECT count(*)::int FROM meetings m WHERE m.lead_id=l.id AND m.outcome='attended') AS attended,
         (SELECT count(*)::int FROM meetings m WHERE m.lead_id=l.id AND m.outcome='no_show') AS no_show
       FROM leads l`,
    ),
  );
});

/** Projects grouped by where they came from. */
router.get('/reports/lead-sources', async (_req, res) => {
  res.json(
    await many(
      `SELECT COALESCE(NULLIF(p.lead_source,''), 'Not set') AS source, count(*)::int AS projects,
              count(*) FILTER (WHERE s.category IN ('in_progress','completed') OR EXISTS (SELECT 1 FROM leads l WHERE l.project_id=p.id))::int AS booked
         FROM projects p JOIN project_stages s ON s.id=p.stage GROUP BY 1 ORDER BY projects DESC`,
    ),
  );
});

const periodSchema = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });

/** Project delivery and money report for [from, to); snapshots are as of now. */
export async function projectReport(from: string, to: string) {
  const currency = await workspaceCurrency();
  const today = isoDay();
  const stages = await many(
    `SELECT s.id, s.label, s.category, count(p.id)::int AS count,
            avg(extract(epoch FROM now() - p.stage_changed_at) / 86400) FILTER (WHERE p.id IS NOT NULL) AS avg_days
       FROM project_stages s LEFT JOIN projects p ON p.stage=s.id AND p.phase='delivery'
      GROUP BY s.id ORDER BY s.position`,
  );
  const active = await many(
    `SELECT p.*, c.name AS client_name, s.label AS stage_label, s.category, s.position AS stage_position
       FROM projects p JOIN project_stages s ON s.id=p.stage JOIN contacts c ON c.id=p.contact_id
      WHERE p.phase='delivery' AND s.category <> 'archived' ORDER BY s.position, p.name`,
  );
  const ids = active.map((p) => p.id);
  const [milestones, overdueTasks, lastMeetings, periodRow, live] = await Promise.all([
    many('SELECT project_id, title, status, due_date, updated_at FROM project_milestones WHERE project_id = ANY($1::uuid[])', [ids]),
    many(
      `SELECT project_id, count(*)::int AS n FROM tasks WHERE project_id = ANY($1::uuid[]) AND NOT completed AND due_date < $2::date GROUP BY project_id`,
      [ids, today],
    ),
    many(
      `SELECT project_id, max(start_at) AS last FROM meetings WHERE project_id = ANY($1::uuid[]) AND status<>'cancelled' AND start_at <= now() GROUP BY project_id`,
      [ids],
    ),
    one(
      `SELECT (SELECT count(*)::int FROM lead_won WHERE won_at >= $1 AND won_at < $2) AS new_from_won,
              (SELECT count(*)::int FROM projects WHERE phase='delivery' AND created_at >= $1 AND created_at < $2) AS new_projects,
              (SELECT count(*)::int FROM project_milestones m JOIN projects p ON p.id=m.project_id
                 WHERE p.phase='delivery' AND m.due_date >= $1::date AND m.due_date < $2::date AND m.due_date <= CURRENT_DATE) AS milestones_due,
              (SELECT count(*)::int FROM project_milestones m JOIN projects p ON p.id=m.project_id
                 WHERE p.phase='delivery' AND m.due_date >= $1::date AND m.due_date < $2::date AND m.due_date <= CURRENT_DATE
                   AND m.status='done' AND m.updated_at::date <= m.due_date) AS milestones_on_time`,
      [from, to],
    ),
    many(
      `SELECT a.project_id, min(a.created_at) AS live_at, w.won_at
         FROM activities a JOIN project_stages s ON a.description = 'Stage changed to ' || s.label AND s.category='completed'
         LEFT JOIN leads l ON l.project_id=a.project_id LEFT JOIN lead_won w ON w.lead_id=l.id
        GROUP BY a.project_id, w.won_at HAVING min(a.created_at) >= $1 AND min(a.created_at) < $2`,
      [from, to],
    ),
  ]);
  const invoices = await invoiceViews(`i.status NOT IN ('draft','void')`, []);
  const byProject = (pid: string) => invoices.filter((i) => i.project_id === pid);

  const projects = active.map((p) => {
    const ms = milestones.filter((m) => m.project_id === p.id);
    const inv = byProject(p.id).filter((i) => i.currency === p.currency);
    const invoiced = inv.reduce((n, i) => n + Number(i.total), 0);
    const outstanding = inv.reduce((n, i) => n + Number(i.balance), 0);
    const last = lastMeetings.find((m) => m.project_id === p.id)?.last;
    return {
      id: p.id,
      name: p.name,
      clientName: p.client_name,
      stageLabel: p.stage_label,
      category: p.category,
      value: Number(p.value),
      currency: p.currency,
      createdOn: new Date(p.created_at).toISOString().slice(0, 10),
      daysInStage: Math.floor((Date.now() - new Date(p.stage_changed_at).getTime()) / DAY),
      milestones: ms.length,
      done: ms.filter((m) => m.status === 'done').length,
      overdueMilestones: ms.filter((m) => m.status !== 'done' && m.due_date && m.due_date < today).length,
      overdueTasks: overdueTasks.find((t) => t.project_id === p.id)?.n ?? 0,
      daysSinceMeeting: last ? Math.floor((Date.now() - new Date(last).getTime()) / DAY) : null,
      age: Math.floor((Date.now() - new Date(p.created_at).getTime()) / DAY),
      invoiced,
      collected: invoiced - outstanding,
      outstanding,
    };
  });
  const isActive = (p: { category: string }) => p.category !== 'completed' && p.category !== 'archived';
  const health = projects
    .filter(isActive)
    .map((p) => {
      const flags: { text: string; tone: 'red' | 'amber' }[] = [];
      if (p.overdueMilestones)
        flags.push({ text: `${p.overdueMilestones} milestone${p.overdueMilestones === 1 ? '' : 's'} overdue`, tone: 'red' });
      if (p.overdueTasks) flags.push({ text: `${p.overdueTasks} task${p.overdueTasks === 1 ? '' : 's'} overdue`, tone: 'red' });
      if (p.daysSinceMeeting === null && p.age >= 14) flags.push({ text: 'No meeting yet', tone: 'amber' });
      if (p.daysSinceMeeting !== null && p.daysSinceMeeting >= 14)
        flags.push({ text: `No meeting ${p.daysSinceMeeting} days`, tone: 'amber' });
      return { ...p, flags };
    })
    .filter((p) => p.flags.length)
    .sort((a, b) => b.overdueMilestones + b.overdueTasks - (a.overdueMilestones + a.overdueTasks));

  const endOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const aging = { dueThisMonth: 0, days30: 0, days60: 0, days60plus: 0 };
  for (const inv of invoices.filter((i) => i.currency === currency))
    for (const it of inv.installments)
      if (it.balance > 0 && it.due_date) {
        const late = Math.floor((Date.parse(today) - Date.parse(it.due_date)) / DAY);
        if (late <= 0) {
          if (it.due_date <= endOfMonth) aging.dueThisMonth += it.balance;
        } else if (late <= 30) aging.days30 += it.balance;
        else if (late <= 60) aging.days60 += it.balance;
        else aging.days60plus += it.balance;
      }

  const weekAhead = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
  const activeIds = new Set(projects.filter(isActive).map((p) => p.id));
  const openMs = milestones.filter((m) => activeIds.has(m.project_id) && m.status !== 'done' && m.due_date);
  const support = milestones
    .filter((m) => /support/i.test(m.title) && m.status === 'in_progress')
    .map((m) => {
      const p = projects.find((x) => x.id === m.project_id)!;
      return {
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        endsOn: m.due_date,
        daysLeft: m.due_date ? Math.ceil((Date.parse(m.due_date) - Date.parse(today)) / DAY) : null,
      };
    });
  const repeatClients = await many(
    `SELECT c.id, c.name, count(*)::int AS projects FROM projects p JOIN contacts c ON c.id=p.contact_id
      WHERE p.phase='delivery' GROUP BY c.id HAVING count(*) > 1 ORDER BY projects DESC, c.name`,
  );
  const closeToLive = live.filter((l) => l.won_at).map((l) => (new Date(l.live_at).getTime() - new Date(l.won_at).getTime()) / DAY);

  return {
    currency,
    stages: stages.map((s) => ({ ...s, avg_days: s.avg_days === null ? null : Number(s.avg_days) })),
    activeProjects: projects.filter(isActive).length,
    activeValue: projects.filter((p) => isActive(p) && p.currency === currency).reduce((n, p) => n + p.value, 0),
    newFromWon: periodRow!.new_from_won,
    newProjects: periodRow!.new_projects,
    wentLive: live.length,
    milestonesDue: periodRow!.milestones_due,
    milestonesOnTime: periodRow!.milestones_on_time,
    closeToLiveDays: closeToLive.length ? closeToLive.reduce((a, b) => a + b, 0) / closeToLive.length : null,
    outstanding: invoices.filter((i) => i.currency === currency).reduce((n, i) => n + Number(i.balance), 0),
    health,
    milestonesDueThisWeek: openMs.filter((m) => m.due_date >= today && m.due_date < weekAhead).length,
    milestonesOverdue: openMs.filter((m) => m.due_date < today).length,
    money: projects
      .filter((p) => p.currency === currency && (p.value > 0 || p.invoiced > 0))
      .map(({ id, name, clientName, value, invoiced, collected }) => ({ id, name, clientName, value, invoiced, collected }))
      .sort((a, b) => b.value - a.value),
    aging,
    support,
    repeatClients,
    projects,
  };
}

router.get('/reports/projects', async (req, res) => {
  const p = parse(periodSchema, req.query);
  res.json(await projectReport(p.from, p.to));
});

router.get('/reports/projects.csv', async (req, res) => {
  const p = parse(periodSchema, req.query);
  const report = await projectReport(p.from, p.to);
  sendCsv(
    res,
    `project-report-${isoDay()}.csv`,
    [
      'Project',
      'Client',
      'Stage',
      'Days in stage',
      'Value',
      'Invoiced',
      'Collected',
      'Outstanding',
      'Currency',
      'Milestones done',
      'Milestones total',
      'Overdue milestones',
      'Overdue tasks',
      'Created',
    ],
    report.projects.map((r) => [
      r.name,
      r.clientName,
      r.stageLabel,
      r.daysInStage,
      minorToDecimal(r.value),
      minorToDecimal(r.invoiced),
      minorToDecimal(r.collected),
      minorToDecimal(r.outstanding),
      r.currency,
      r.done,
      r.milestones,
      r.overdueMilestones,
      r.overdueTasks,
      r.createdOn,
    ]),
  );
});
