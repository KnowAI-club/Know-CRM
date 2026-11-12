import type { Response } from 'express';

/** Formula-injection-safe CSV cell. */
export function csvCell(value: unknown) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`﻿${body}\r\n`);
}

export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const minorToDecimal = (n: number) => (Number(n || 0) / 100).toFixed(2);
