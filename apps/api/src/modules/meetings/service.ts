import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { projectActivity } from '../../lib/activity.js';
import { env } from '../../config/env.js';
import type { SessionUser } from '../../middleware/auth.js';

export const KIND_LABELS: Record<string, string> = { video: 'video call', phone: 'phone call', in_person: 'in person' };

export const notificationList = z
  .array(z.object({ channel: z.enum(['in_app', 'email']), minutes: z.coerce.number().int().min(0).max(40320) }))
  .max(5, 'Use up to five notifications.')
  .default([])
  .transform((list) => {
    const seen = new Map(list.map((n) => [`${n.channel}:${n.minutes}`, n]));
    return [...seen.values()].sort((a, b) => a.minutes - b.minutes || a.channel.localeCompare(b.channel));
  });

/** "in 2 hours", "in 1 day", "now". */
export function whenLabel(minutes: number) {
  if (minutes === 0) return 'now';
  const unit = (n: number, w: string) => `in ${n} ${w}${n === 1 ? '' : 's'}`;
  if (minutes % 10080 === 0) return unit(minutes / 10080, 'week');
  if (minutes % 1440 === 0) return unit(minutes / 1440, 'day');
  if (minutes % 60 === 0) return unit(minutes / 60, 'hour');
  return unit(minutes, 'minute');
}

/** Rebuilds a meeting's automatic reminders from its notification settings. */
export async function syncNotices(meetingId: string) {
  await query('DELETE FROM reminders WHERE meeting_id=$1 AND auto_notice AND status=$2', [meetingId, 'pending']);
  const m = await one('SELECT * FROM meetings WHERE id=$1', [meetingId]);
  if (!m || m.status === 'cancelled') return;
  const recipients = await many<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.role <> 'client' AND u.disabled_at IS NULL
        AND (u.id = $1 OR u.id IN (SELECT user_id FROM meeting_participants WHERE meeting_id=$2 AND user_id IS NOT NULL))`,
    [m.organizer_id, meetingId],
  );
  const start = new Date(m.start_at).getTime();
  for (const n of m.notifications as { channel: 'in_app' | 'email'; minutes: number }[]) {
    const runAt = new Date(start - n.minutes * 60_000);
    if (runAt.getTime() < Date.now()) continue;
    if (n.channel === 'email' && !env.MAIL_ENABLED) continue;
    for (const r of recipients)
      await query(
        `INSERT INTO reminders(created_by, recipient_id, meeting_id, title, body, channel, run_at, auto_notice)
         VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
        [
          m.organizer_id,
          r.id,
          meetingId,
          `${m.title} starts ${whenLabel(n.minutes)}`.slice(0, 200),
          m.meeting_url || m.location || '',
          n.channel,
          runAt,
        ],
      );
  }
}

/** Loads a meeting the current user may see; clients only see shared meetings they take part in. */
export async function meetingFor(user: SessionUser, id: string, write = false) {
  const m = await one('SELECT * FROM meetings WHERE id=$1', [id]);
  if (!m) throw notFound('Meeting');
  if (user.role !== 'client') return m;
  if (write) throw forbidden('Only the team can change this meeting.');
  const ok =
    m.project_id &&
    m.sharing === 'client' &&
    (await one('SELECT 1 FROM project_access WHERE project_id=$1 AND user_id=$2', [m.project_id, user.id])) &&
    (await one('SELECT 1 FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2', [id, user.id]));
  if (!ok) throw notFound('Meeting');
  return m;
}

/** Checks the lead/project a meeting attaches to is still open for new work. */
export async function assertTarget(target: { projectId?: string | null; leadId?: string | null }) {
  if (!!target.projectId === !!target.leadId) throw badRequest('Choose one lead or project.');
  if (target.leadId) {
    const lead = await one('SELECT state FROM leads WHERE id=$1', [target.leadId]);
    if (!lead) throw notFound('Lead');
    if (lead.state === 'won') throw conflict('This lead has been handed off. Continue work in its linked project.');
    if (lead.state === 'dropped') throw conflict('This lead is archived.');
  } else {
    const p = await one('SELECT s.category FROM projects p JOIN project_stages s ON s.id=p.stage WHERE p.id=$1', [target.projectId]);
    if (!p) throw notFound('Project');
    if (p.category === 'archived') throw conflict('This project is archived.');
  }
}

/** Replaces participants: organizer + team/client users + external guests. */
export async function setParticipants(
  meetingId: string,
  organizerId: string,
  projectId: string | null,
  userIds: string[],
  externalEmails: string[],
) {
  const ids = [...new Set([organizerId, ...userIds])];
  const users = await many(`SELECT id, name, email, role FROM users WHERE id = ANY($1::uuid[]) AND disabled_at IS NULL`, [ids]);
  if (users.length !== ids.length) throw badRequest('Choose active participants.');
  for (const u of users) {
    if (u.role !== 'client') continue;
    const access = projectId && (await one('SELECT 1 FROM project_access WHERE project_id=$1 AND user_id=$2', [projectId, u.id]));
    if (!access) throw badRequest('Client participant needs project access.');
  }
  await query('DELETE FROM meeting_participants WHERE meeting_id=$1', [meetingId]);
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
  for (const u of users)
    await query('INSERT INTO meeting_participants(meeting_id,email,user_id,name) VALUES($1,$2,$3,$4)', [
      meetingId,
      u.email.toLowerCase(),
      u.id,
      u.name,
    ]);
  for (const email of new Set(externalEmails.map((e) => e.toLowerCase())))
    if (!userEmails.has(email))
      await query('INSERT INTO meeting_participants(meeting_id,email,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
        meetingId,
        email,
        '',
      ]);
}

export interface NewMeeting {
  title: string;
  projectId?: string | null;
  leadId?: string | null;
  kind: 'video' | 'phone' | 'in_person';
  startAt: string;
  durationMinutes: number;
  participantIds?: string[];
  externalEmails?: string[];
  location?: string;
  meetingUrl?: string;
  notifications?: { channel: 'in_app' | 'email'; minutes: number }[];
  source?: 'crm' | 'booking' | 'upload';
  bookingReservationId?: string | null;
  sharing?: 'internal' | 'client';
}

export async function createMeeting(organizer: Pick<SessionUser, 'id' | 'name' | 'role'>, m: NewMeeting) {
  if (m.notifications?.some((n) => n.channel === 'email') && !env.MAIL_ENABLED)
    throw conflict('Email sending is turned off. Use in-app notifications instead.');
  const row = await one(
    `INSERT INTO meetings(organizer_id, project_id, lead_id, booking_reservation_id, title, kind, start_at, duration_minutes,
       location, meeting_url, source, notifications, sharing)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      organizer.id,
      m.projectId ?? null,
      m.leadId ?? null,
      m.bookingReservationId ?? null,
      m.title,
      m.kind,
      m.startAt,
      m.durationMinutes,
      m.location ?? '',
      m.meetingUrl ?? '',
      m.source ?? 'crm',
      JSON.stringify(m.notifications ?? []),
      m.sharing ?? 'internal',
    ],
  );
  await setParticipants(row!.id, organizer.id, m.projectId ?? null, m.participantIds ?? [], m.externalEmails ?? []);
  await syncNotices(row!.id);
  if (m.projectId)
    await projectActivity(
      organizer,
      m.projectId,
      `Meeting scheduled: ${m.title} on [[at:${new Date(m.startAt).toISOString()}]] (${m.durationMinutes} min, ${KIND_LABELS[m.kind]})`,
    );
  return row!;
}
