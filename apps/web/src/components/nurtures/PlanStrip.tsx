import { cn } from '@/lib/cn';
import { dateTime } from '@/lib/format';
import type { CellStatus, PlanCell } from './types';

const STYLES: Record<CellStatus, string> = {
  replied: 'bg-ok text-white border-ok',
  sent: 'bg-acc text-acc-ink border-acc',
  due: 'bg-warn-soft text-warn border-warn',
  scheduled: 'bg-card text-acc border-acc',
  paused: 'bg-subtle text-faint border-line',
  upcoming: 'bg-card text-faint border-line',
};
export const STATUS_LABELS: Record<CellStatus, string> = {
  replied: 'Replied',
  sent: 'Sent',
  due: 'Due now',
  scheduled: 'Next',
  paused: 'Paused',
  upcoming: 'Upcoming',
};

/** Compact progress of a lead through a sequence: one dot per email. */
export function PlanStrip({ plan }: { plan: PlanCell[] }) {
  return (
    <div className="flex items-center gap-1">
      {plan.map((c) => (
        <span
          key={c.email_id}
          title={`Email ${c.position + 1} · ${STATUS_LABELS[c.status]} · ${c.sent_at ? `sent ${dateTime(c.sent_at)}` : `due ${dateTime(c.due_at)}`}`}
          className={cn('grid h-5 w-5 place-items-center rounded-full border text-[10px] font-semibold', STYLES[c.status])}
        >
          {c.position + 1}
        </span>
      ))}
    </div>
  );
}

export function cellTone(status: CellStatus) {
  return ({ replied: 'ok', sent: 'acc', due: 'warn', scheduled: 'info', paused: 'neutral', upcoming: 'neutral' } as const)[status];
}
