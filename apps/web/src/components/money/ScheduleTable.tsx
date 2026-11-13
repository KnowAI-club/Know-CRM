'use client';
import Link from 'next/link';
import { Badge, Button } from '@/components/ui';
import { date } from '@/lib/format';
import type { RecurringSchedule } from './types';

const STATE_TONE = {
  active: 'ok',
  paused: 'warn',
  cancelled: 'neutral',
  completed: 'info',
} as const;

export function ScheduleTable({
  schedules,
  busy,
  onChange,
}: {
  schedules: RecurringSchedule[];
  busy: string | null;
  onChange: (s: RecurringSchedule, next: 'active' | 'paused' | 'cancelled') => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>From</th>
            <th>Repeats</th>
            <th>Next draft</th>
            <th>Created</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/invoices/${s.source_invoice_id}`} className="font-medium hover:underline">
                  {s.source_number}
                </Link>
                <p className="text-xs text-mute">{s.project_name}</p>
              </td>
              <td className="capitalize">
                {s.interval}
                {s.end_date ? ` until ${date(s.end_date)}` : ''}
              </td>
              <td>{s.state === 'active' || s.state === 'paused' ? date(s.next_date) : '—'}</td>
              <td className="tabular-nums">
                {s.generated} of {s.max_occurrences}
              </td>
              <td>
                <Badge tone={STATE_TONE[s.state]}>{s.state}</Badge>
              </td>
              <td className="text-right whitespace-nowrap">
                {s.state === 'active' && (
                  <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => onChange(s, 'paused')}>
                    Pause
                  </Button>
                )}
                {s.state === 'paused' && (
                  <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => onChange(s, 'active')}>
                    Resume
                  </Button>
                )}
                {(s.state === 'active' || s.state === 'paused') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    disabled={busy === s.id}
                    onClick={() => onChange(s, 'cancelled')}
                  >
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
