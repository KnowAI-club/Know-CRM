import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { many, query } from '../db/pool.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal Markdown-lite → HTML: **bold**, *italic*, [label](url), paragraphs and line breaks. */
export function markdownLite(text: string) {
  return escape(text)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p>${p
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>')
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  category?: string;
  relatedEntity?: string;
  relatedId?: string;
  sendAfter?: Date;
}

/** Queues an email in the outbox; the worker delivers it over SMTP. */
export async function queueMail(m: MailInput) {
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#1a1a17">${markdownLite(m.text)}</div>`;
  await query(
    `INSERT INTO mail_outbox(to_address, subject, html, text_body, category, related_entity, related_id, status, send_after)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      m.to,
      m.subject.slice(0, 300),
      html,
      m.text,
      m.category ?? 'transactional',
      m.relatedEntity ?? null,
      m.relatedId ?? null,
      env.MAIL_ENABLED ? 'queued' : 'skipped',
      m.sendAfter ?? new Date(),
    ],
  );
}

/** Sends one email immediately (used for test sends); throws on SMTP failure. */
export async function sendNow(m: { to: string; subject: string; text: string }) {
  if (!env.MAIL_ENABLED) throw new Error('Email sending is turned off (MAIL_ENABLED=false).');
  await transport.sendMail({
    from: env.MAIL_FROM,
    to: m.to,
    subject: m.subject,
    text: m.text,
    html: markdownLite(m.text),
  });
}

/** Worker job: delivers queued outbox rows with retry/backoff. */
export async function deliverOutbox(limit = 20) {
  if (!env.MAIL_ENABLED) return;
  const rows = await many(
    `UPDATE mail_outbox SET attempts = attempts + 1, send_after = now() + interval '5 minutes'
      WHERE id IN (SELECT id FROM mail_outbox WHERE status='queued' AND send_after <= now()
                   ORDER BY send_after LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limit],
  );
  for (const row of rows) {
    try {
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: row.to_address,
        subject: row.subject,
        html: row.html,
        text: row.text_body ?? undefined,
      });
      await query(`UPDATE mail_outbox SET status='sent', sent_at=now(), error=NULL WHERE id=$1`, [row.id]);
    } catch (e) {
      const failed = row.attempts >= 5;
      await query(
        `UPDATE mail_outbox SET status=$2, error=$3, send_after = now() + make_interval(mins => $4) WHERE id=$1`,
        [row.id, failed ? 'failed' : 'queued', String((e as Error).message).slice(0, 500), 2 ** row.attempts],
      );
    }
  }
}
