'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { addDays, browserZone, dateInZone } from './util';

export interface Slot {
  startAt: string;
  endAt: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Month calendar (in the host's time zone) plus the open slots on the chosen day.
 * Times are shown in the visitor's own time zone.
 */
export function SlotPicker({
  timezone,
  horizon,
  loadSlots,
  value,
  onChange,
}: {
  timezone: string;
  horizon: number;
  loadSlots: (date: string, signal: AbortSignal) => Promise<Slot[]>;
  value: string | null;
  onChange: (startAt: string | null) => void;
}) {
  const first = useMemo(() => dateInZone(new Date(), timezone), [timezone]);
  const last = useMemo(() => addDays(first, horizon), [first, horizon]);
  const [day, setDay] = useState(first);
  const [month, setMonth] = useState(first.slice(0, 7));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState('');
  const viewer = useMemo(() => browserZone(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setSlots(null);
    setError('');
    loadSlots(day, ctrl.signal)
      .then((s) => !ctrl.signal.aborted && setSlots(s))
      .catch((e) => !ctrl.signal.aborted && setError(errorMessage(e)));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const startWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  const shiftMonth = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: viewer, hour: 'numeric', minute: '2-digit' });

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_200px]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={month <= first.slice(0, 7)}
            className="rounded-md p-1.5 text-mute hover:bg-subtle disabled:opacity-30"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold">
            {MONTHS[m - 1]} {y}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={month >= last.slice(0, 7)}
            className="rounded-md p-1.5 text-mute hover:bg-subtle disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={i} className="py-1 font-medium text-faint">
              {d}
            </span>
          ))}
          {cells.map((c, i) =>
            c ? (
              <button
                key={c}
                type="button"
                disabled={c < first || c > last}
                onClick={() => {
                  setDay(c);
                  onChange(null);
                }}
                aria-pressed={c === day}
                className={cn(
                  'aspect-square rounded-lg text-sm transition disabled:text-faint/50',
                  c === day ? 'bg-acc font-semibold text-acc-ink' : 'hover:bg-acc-soft enabled:text-ink',
                )}
              >
                {Number(c.slice(8))}
              </button>
            ) : (
              <span key={`b${i}`} />
            ),
          )}
        </div>
        <p className="mt-3 text-xs text-faint">Dates follow the host&apos;s calendar ({timezone}).</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">
          {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' })}
        </p>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !slots ? (
          <p className="flex items-center gap-2 text-sm text-mute">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding times…
          </p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-mute">No open times on this day. Try another date.</p>
        ) : (
          <div className="grid max-h-80 grid-cols-2 gap-1.5 overflow-y-auto pr-1 md:grid-cols-1">
            {slots.map((s) => (
              <button
                key={s.startAt}
                type="button"
                onClick={() => onChange(s.startAt)}
                aria-pressed={value === s.startAt}
                className={cn(
                  'h-9 rounded-lg border text-sm font-medium transition',
                  value === s.startAt ? 'border-acc bg-acc text-acc-ink' : 'border-line text-acc hover:border-acc',
                )}
              >
                {fmtTime(s.startAt)}
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-faint">Times in your zone ({viewer}).</p>
      </div>
    </div>
  );
}
