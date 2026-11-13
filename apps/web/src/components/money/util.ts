/** RFC 4122 v4 id; falls back to getRandomValues where randomUUID is unavailable (plain-HTTP origins). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "9" → 900 basis points; returns null for anything that is not a 0–100 percentage with ≤ 2 decimals. */
export function percentToBp(text: string): number | null {
  const clean = text.trim();
  if (clean === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return bp > 10000 ? null : bp;
}

export const bpToPercent = (bp: number) => String(Number((bp / 100).toFixed(2)));

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Field errors from an ApiError, keyed by the API's zod path ("lines.0.name"). */
export function fieldErrors(e: unknown): Record<string, string> {
  const fields = (e as { details?: { fields?: Record<string, string> } })?.details?.fields;
  return fields ?? {};
}
