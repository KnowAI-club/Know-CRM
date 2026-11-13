/**
 * Nurture schedule: when each email of a sequence is due for a lead.
 * Nothing is sent automatically; the team marks each email sent by hand.
 */
const IST = 330 * 60_000;
const DAY = 86_400_000;

/** The India-time calendar date of `startedAt` plus `day` days, at HH:MM India time. */
export function dueAt(startedAt: Date, day: number, time: string) {
  const local = new Date(startedAt.getTime() + IST);
  const [h, m] = time.split(':').map(Number);
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, h ?? 0, m ?? 0);
  return new Date(utc - IST);
}

export interface SeqEmail {
  id: string;
  position: number;
  day: number;
  send_time: string;
  subject: string;
}

export interface Step {
  email_id: string;
  sent_at: Date | string | null;
  replied_at: Date | string | null;
}

export type CellStatus = 'replied' | 'sent' | 'paused' | 'due' | 'scheduled' | 'upcoming';

export interface PlanCell {
  email_id: string;
  position: number;
  day: number;
  subject: string;
  due_at: string;
  sent_at: string | null;
  replied_at: string | null;
  status: CellStatus;
}

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

export function plan(
  assignment: { started_at: Date | string; paused_at?: Date | string | null },
  sequence: { weekly_cap: boolean; stop_on_reply: boolean },
  emails: SeqEmail[],
  steps: Step[],
  now = new Date(),
): PlanCell[] {
  const byEmail = new Map(steps.map((s) => [s.email_id, s]));
  const anyReply = steps.some((s) => s.replied_at);
  const paused = !!assignment.paused_at || (sequence.stop_on_reply && anyReply);
  const start = new Date(assignment.started_at);
  const cells: PlanCell[] = [];
  let previous: Date | null = null;
  let firstOpen = true;
  for (const e of [...emails].sort((a, b) => a.position - b.position)) {
    const step = byEmail.get(e.id);
    let due = dueAt(start, e.day, e.send_time);
    if (sequence.weekly_cap && previous && due.getTime() < previous.getTime() + 7 * DAY) due = new Date(previous.getTime() + 7 * DAY);
    let status: CellStatus;
    if (step?.replied_at) status = 'replied';
    else if (step?.sent_at) status = 'sent';
    else if (paused) status = 'paused';
    else if (firstOpen) {
      status = due <= now ? 'due' : 'scheduled';
      firstOpen = false;
    } else status = 'upcoming';
    if (status === 'replied' || status === 'sent') previous = new Date(step!.sent_at ?? due);
    else previous = due;
    cells.push({
      email_id: e.id,
      position: e.position,
      day: e.day,
      subject: e.subject,
      due_at: due.toISOString(),
      sent_at: iso(step?.sent_at),
      replied_at: iso(step?.replied_at),
      status,
    });
  }
  return cells;
}

export function nextAction(cells: PlanCell[]) {
  if (cells.some((c) => c.status === 'replied')) return { kind: 'reply' as const, group: 'replied' as const };
  const open = cells.find((c) => c.status === 'due' || c.status === 'scheduled');
  if (open)
    return {
      kind: open.status === 'due' ? ('send' as const) : ('wait' as const),
      at: open.due_at,
      emailId: open.email_id,
      group: 'active' as const,
    };
  if (cells.some((c) => c.status === 'paused')) return { kind: 'paused' as const, group: 'paused' as const };
  return { kind: 'decide' as const, group: 'completed' as const };
}
