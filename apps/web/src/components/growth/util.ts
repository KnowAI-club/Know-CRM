import { ApiError } from '@/lib/api';

/** Field-level messages from an API validation error, keyed by dotted path. */
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? (e.details?.fields ?? {}) : {};
}

/** Random lowercase hex string of `bytes` bytes (cryptographically secure). */
export function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId() {
  return crypto.randomUUID();
}

export function absoluteUrl(path: string) {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

export const publicFormPath = (token: string) => `/f/${token}`;
export const publicBookingPath = (token: string) => `/book/${token}`;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateInZone(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatInZone(iso: string, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString('en-IN', { timeZone, ...opts });
}

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function minutesLabel(m: number) {
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hr`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}
