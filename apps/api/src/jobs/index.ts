import { many, query } from '../db/pool.js';
import { deliverOutbox } from '../lib/mail.js';
import { registerJob } from './runner.js';
import { deliverReminders } from '../modules/reminders/service.js';
import { runRecurringInvoices } from '../modules/invoices/routes.js';

/**
 * Creates one "Record outcome" task for each ended meeting without an outcome,
 * assigned to the lead owner when active, else the organizer.
 */
export async function createRecordOutcomeTasks(limit = 100) {
  const rows = await many(
    `SELECT m.id, m.title, m.project_id, m.lead_id, m.organizer_id, l.data->>'ownerId' AS owner_id
       FROM meetings m LEFT JOIN leads l ON l.id = m.lead_id
      WHERE m.status <> 'cancelled' AND m.outcome IS NULL AND m.source <> 'upload'
        AND m.start_at + make_interval(mins => m.duration_minutes) < now()
        AND m.start_at > now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.kind='record_outcome' AND t.source_id = m.id::text)
      ORDER BY m.start_at LIMIT $1`,
    [limit],
  );
  for (const m of rows) {
    const assignee = await many(
      `SELECT id FROM users WHERE id::text = ANY($1::text[]) AND disabled_at IS NULL AND role <> 'client'`,
      [[m.owner_id, m.organizer_id].filter(Boolean)],
    );
    const pick = assignee.find((u) => u.id === m.owner_id) ?? assignee.find((u) => u.id === m.organizer_id);
    if (!pick) continue;
    await query(
      `INSERT INTO tasks(project_id, lead_id, title, due_date, assignee_id, kind, source_id)
       VALUES($1,$2,$3,CURRENT_DATE,$4,'record_outcome',$5) ON CONFLICT DO NOTHING`,
      [m.project_id, m.project_id ? null : m.lead_id, `Record outcome: ${m.title}`.slice(0, 500), pick.id, m.id],
    );
  }
}

export function registerJobs() {
  registerJob({ name: 'mail-outbox', every: 15, run: () => deliverOutbox() });
  registerJob({ name: 'reminders', every: 30, run: () => deliverReminders() });
  registerJob({ name: 'recurring-invoices', every: 3600, run: async () => void (await runRecurringInvoices()) });
  registerJob({ name: 'record-outcome-tasks', every: 600, run: () => createRecordOutcomeTasks() });
}
