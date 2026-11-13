/** Formats an amount stored in minor units (paise/cents). */
export function money(minor: number | null | undefined, currency = 'INR') {
  const n = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function date(value?: string | null, opts: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

export function dateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function time(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function relative(value?: string | null) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [604_800_000, 'day'],
    [2_629_800_000, 'week'],
    [31_557_600_000, 'month'],
    [Infinity, 'year'],
  ];
  const sizes = [1000, 60_000, 3_600_000, 86_400_000, 604_800_000, 2_629_800_000, 31_557_600_000];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i]![0]) {
      const v = Math.round(diff / sizes[i]!);
      return rtf.format(-v, units[i]![1] as Intl.RelativeTimeFormatUnit);
    }
  }
  return date(value);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function titleCase(s?: string | null) {
  return (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "1,234.50" → 123450 minor units; returns null when the text is not a valid amount. */
export function toMinor(text: string | number): number | null {
  const clean = String(text).replace(/[,\s]/g, '');
  if (clean === '') return 0;
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** 123450 → "1234.50" for editing in an input. */
export function fromMinor(minor: number | null | undefined) {
  const n = Number(minor || 0);
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

export function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}
