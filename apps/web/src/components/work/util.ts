import { ApiError, errorMessage } from '@/lib/api';

/** Splits an API error into per-field messages and a general message for the form. */
export function formErrors(e: unknown, known: string[]): { fields: Record<string, string>; general: string } {
  const fields: Record<string, string> = {};
  if (e instanceof ApiError && e.details?.fields) {
    for (const [key, msg] of Object.entries(e.details.fields)) {
      const root = key.split('.')[0]!;
      if (known.includes(root)) fields[root] ??= msg;
    }
  }
  const general = Object.keys(fields).length ? '' : errorMessage(e).replace(/^[\w.]+: /, '');
  return { fields, general };
}

/** ISO timestamp → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local value → ISO timestamp (or '' when empty/invalid). */
export function fromLocalInput(value: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Local day boundaries for API period queries. */
export function dayPeriod(day: Date = new Date()) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: start.toISOString(), to: end.toISOString(), fromDay: ymd(start), toDay: ymd(start) };
}

/** A local Date `days` from today as YYYY-MM-DD. */
export function ymdOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newId() {
  return crypto.randomUUID();
}

export const MEETING_KINDS = [
  { value: 'video', label: 'Video call' },
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person' },
] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number]['value'];

export const OUTCOMES = [
  { value: 'attended', label: 'Attended' },
  { value: 'no_show', label: 'No-show' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

export function outcomeLabel(o?: string | null) {
  return OUTCOMES.find((x) => x.value === o)?.label ?? '';
}

/** "in 30 minutes" style label for meeting notifications. */
export function noticeLabel(minutes: number) {
  if (minutes === 0) return 'At start time';
  const u = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} before`;
  if (minutes % 10080 === 0) return u(minutes / 10080, 'week');
  if (minutes % 1440 === 0) return u(minutes / 1440, 'day');
  if (minutes % 60 === 0) return u(minutes / 60, 'hour');
  return u(minutes, 'minute');
}
