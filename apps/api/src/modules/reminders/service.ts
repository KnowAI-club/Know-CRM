import { many, one, query, transaction } from '../../db/pool.js';
import { notify } from '../../lib/notify.js';
import { queueMail } from '../../lib/mail.js';
import { env } from '../../config/env.js';

export interface ReminderTarget {
  recipient_id: string;
  created_by: string;
  project_id?: string | null;
  lead_id?: string | null;
  meeting_id?: string | null;
}

/**
 * Where a reminder points, or null when it should not be delivered
 * (inactive people, lost access, cancelled meeting, archived project).
 * Checked when scheduling and again at delivery time.
 */
export async function reminderContext(r: ReminderTarget): Promise<{ link: string; recipient: { email: string; name: string } } | null> {
  const recipient = await one<{ id: string; role: string; email: string; name: string }>(
    `SELECT id, role, email, name FROM users WHERE id=$1 AND disabled_at IS NULL`,
    [r.recipient_id],
  );
  const creator = await one(`SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL AND role<>'client'`, [r.created_by]);
  if (!recipient || !creator) return null;
  if (r.meeting_id) {
    if (recipient.role === 'client') return null;
    const m = await one(`SELECT status FROM meetings WHERE id=$1`, [r.meeting_id]);
    return m && m.status !== 'cancelled' ? { link: `/meetings/${r.meeting_id}`, recipient } : null;
  }
  if (r.lead_id) {
    if (recipient.role === 'client') return null;
    const lead = await one('SELECT project_id FROM leads WHERE id=$1', [r.lead_id]);
    if (!lead) return null;
    return { link: lead.project_id ? `/projects/${lead.project_id}` : `/leads/${r.lead_id}`, recipient };
  }
  const p = await one(`SELECT s.category FROM projects p JOIN project_stages s ON s.id=p.stage WHERE p.id=$1`, [r.project_id]);
  if (!p || p.category === 'archived') return null;
  if (recipient.role === 'client') {
    const access = await one('SELECT 1 FROM project_access WHERE project_id=$1 AND user_id=$2', [r.project_id, recipient.id]);
    return access ? { link: `/portal/projects/${r.project_id}`, recipient } : null;
  }
  return { link: `/projects/${r.project_id}`, recipient };
}

/** Worker job: delivers due reminders in-app or by email (through the local outbox). */
export async function deliverReminders(limit = 50) {
  await transaction(async () => {
    const due = await many(
      `SELECT * FROM reminders WHERE status='pending' AND run_at <= now() ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const r of due) {
      try {
        const ctx = await reminderContext(r as ReminderTarget);
        if (!ctx) {
          await query(
            `UPDATE reminders SET status='skipped', attempts=attempts+1, last_error='Resource completed or access no longer available', updated_at=now() WHERE id=$1`,
            [r.id],
          );
          continue;
        }
        if (r.channel === 'email' && env.MAIL_ENABLED) {
          await queueMail({
            to: ctx.recipient.email,
            subject: r.title,
            text: `${r.body ? `${r.body}\n\n` : ''}Open: ${env.APP_ORIGIN}${ctx.link}`,
            category: 'reminder',
            relatedEntity: 'reminder',
            relatedId: r.id,
          });
        } else {
          await notify({ userId: r.recipient_id, title: r.title, body: r.body, link: ctx.link, kind: 'reminder' });
        }
        await query(`UPDATE reminders SET status='sent', attempts=attempts+1, last_error='', updated_at=now() WHERE id=$1`, [r.id]);
      } catch (error) {
        const attempts = r.attempts + 1;
        await query(`UPDATE reminders SET status=$2, attempts=$3, last_error=$4, run_at=$5, updated_at=now() WHERE id=$1`, [
          r.id,
          attempts < 5 ? 'pending' : 'failed',
          attempts,
          error instanceof Error ? error.message.slice(0, 500) : 'Delivery failed',
          new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
        ]);
      }
    }
  });
}
