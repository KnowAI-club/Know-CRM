import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { conflict } from '../../lib/errors.js';
import { projectActivity } from '../../lib/activity.js';
import { notify } from '../../lib/notify.js';
import { queueMail } from '../../lib/mail.js';
import { workspaceCurrency, getSettings } from '../../lib/settings.js';
import { leadHistory } from '../../lib/activity.js';
import { ensureContact } from '../contacts/service.js';
import { createMeeting, syncNotices } from '../meetings/service.js';

const MIN = 60_000;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const bookingTypeSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  description: z.string().trim().max(5000).default(''),
  timezone: z.string().refine(isTimezone, 'Choose a valid time zone.').default('Asia/Kolkata'),
  duration: z.coerce
    .number()
    .int()
    .min(15)
    .max(480)
    .refine((n) => n % 15 === 0, 'Use steps of 15 minutes.'),
  bufferBefore: z.coerce.number().int().min(0).max(240).default(0),
  bufferAfter: z.coerce.number().int().min(0).max(240).default(0),
  minimumNotice: z.coerce.number().int().min(0).max(43200).default(60),
  horizon: z.coerce.number().int().min(1).max(365).default(60),
  availability: z
    .array(z.object({ day: z.number().int().min(0).max(6), start: hhmm, end: hhmm }))
    .min(1, 'Add at least one availability window.')
    .max(28)
    .superRefine((list, ctx) => {
      list.forEach((w, i) => {
        if (toMinutes(w.start) >= toMinutes(w.end))
          ctx.addIssue({ code: 'custom', path: [i], message: 'Each window must end after it starts.' });
        for (const o of list.slice(0, i))
          if (o.day === w.day && toMinutes(o.start) < toMinutes(w.end) && toMinutes(w.start) < toMinutes(o.end))
            ctx.addIssue({ code: 'custom', path: [i], message: 'Availability windows on the same day cannot overlap.' });
      });
    }),
  location: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
});

export interface BookingType {
  id: string;
  host_id: string;
  title: string;
  timezone: string;
  duration: number;
  buffer_before: number;
  buffer_after: number;
  minimum_notice: number;
  horizon: number;
  availability: { day: number; start: string; end: string }[];
  location: string;
}

/** Local calendar date and minute-of-day of an instant in a time zone. */
function localParts(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const localDate = (at: Date, tz: string) => localParts(at, tz).date;

/**
 * Open slots on a local date: inside an availability window, within notice and
 * horizon, and clear of the host's reservations and meetings (with buffers).
 */
export async function candidateSlots(type: BookingType, date: string, opts: { excludeReservationId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const windows = type.availability.filter((w) => w.day === weekday);
  if (!windows.length) return [];
  const center = Date.parse(`${date}T00:00:00Z`);
  const earliest = now.getTime() + type.minimum_notice * MIN;
  const latest = now.getTime() + type.horizon * 1440 * MIN;
  const slots: { start: Date; end: Date }[] = [];
  for (let t = center - 16 * 60 * MIN; t <= center + 40 * 60 * MIN; t += 15 * MIN) {
    if (t < earliest || t > latest) continue;
    const start = new Date(t);
    const end = new Date(t + type.duration * MIN);
    const s = localParts(start, type.timezone);
    const e = localParts(end, type.timezone);
    if (s.date !== date || e.date !== date) continue;
    if (!windows.some((w) => toMinutes(w.start) <= s.minute && e.minute <= toMinutes(w.end))) continue;
    slots.push({ start, end });
  }
  if (!slots.length) return [];
  const from = new Date(slots[0]!.start.getTime() - type.buffer_before * MIN);
  const to = new Date(slots.at(-1)!.end.getTime() + type.buffer_after * MIN);
  const busy = await many<{ s: Date; e: Date }>(
    `SELECT blocked_start AS s, blocked_end AS e FROM booking_reservations
      WHERE host_id=$1 AND status='confirmed' AND blocked_start < $3 AND blocked_end > $2 AND id IS DISTINCT FROM $4
     UNION ALL
     SELECT m.start_at, m.start_at + make_interval(mins => m.duration_minutes) FROM meetings m
      WHERE m.status <> 'cancelled' AND m.source <> 'upload'
        AND (m.organizer_id=$1 OR EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id=m.id AND p.user_id=$1))
        AND m.start_at < $3 AND m.start_at + make_interval(mins => m.duration_minutes) > $2
        AND m.booking_reservation_id IS DISTINCT FROM $4`,
    [type.host_id, from, to, opts.excludeReservationId ?? null],
  );
  return slots.filter(({ start, end }) => {
    const a = start.getTime() - type.buffer_before * MIN;
    const b = end.getTime() + type.buffer_after * MIN;
    return !busy.some((x) => a < new Date(x.e).getTime() && b > new Date(x.s).getTime());
  });
}

export async function assertSlot(type: BookingType, startAt: Date, excludeReservationId?: string) {
  const slots = await candidateSlots(type, localDate(startAt, type.timezone), { excludeReservationId });
  if (!slots.some((s) => s.start.getTime() === startAt.getTime()))
    throw conflict('This time is no longer available. Please choose another.');
}

const fmt = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(at) + ` (${tz})`;

/**
 * A new public booking becomes CRM work: a contact, an intake project (unless the
 * contact already has an open one), a lead for the sales team, and a meeting.
 */
export async function onReservationCreated(type: BookingType, r: { id: string; name: string; email: string; start_at: Date }) {
  const host = (await one<{ id: string; name: string; role: string }>('SELECT id, name, role FROM users WHERE id=$1', [type.host_id]))!;
  const contact = await ensureContact({ name: r.name, email: r.email }, 'Website');
  let project = await one<{ id: string }>(
    `SELECT p.id FROM projects p JOIN project_stages s ON s.id=p.stage
      WHERE p.contact_id=$1 AND s.category NOT IN ('completed','archived') ORDER BY p.updated_at DESC LIMIT 1`,
    [contact.id],
  );
  let leadId: string | null = null;
  if (!project) {
    project = await one<{ id: string }>(
      `INSERT INTO projects(name, contact_id, stage, phase, value, currency, description, lead_source, owner_id)
       VALUES($1,$2,'inquiry','intake',0,$3,$4,'Booking',$5) RETURNING id`,
      [`${type.title} · ${r.name}`.slice(0, 500), contact.id, await workspaceCurrency(), `Booked through: ${type.title}`, host.id],
    );
    const open = await one(`SELECT id FROM leads WHERE lower(email)=lower($1) AND state IN ('active','nurture')`, [r.email]);
    if (open) leadId = open.id;
    else if (!(await one(`SELECT 1 FROM leads WHERE lower(email)=lower($1) AND state='won'`, [r.email]))) {
      const stage = await one(`SELECT id FROM lead_stages WHERE kind='open' ORDER BY position LIMIT 1`);
      const settings = await getSettings();
      const owner = settings?.data?.defaultLeadOwnerId || host.id;
      const lead = await one(`INSERT INTO leads(name, email, stage, data, contact_id) VALUES($1,lower($2),$3,$4,$5) RETURNING id`, [
        r.name,
        r.email,
        stage!.id,
        JSON.stringify({ source: 'Booking', ownerId: owner, company: contact.company ?? '' }),
        contact.id,
      ]);
      leadId = lead!.id;
      await leadHistory(leadId!, null, 'Lead created', { reason: `Booked ${type.title}` });
    }
  }
  await projectActivity({ name: r.name }, project!.id, `Booked ${type.title}`);
  const meeting = await createMeeting(host as any, {
    title: `${type.title} with ${r.name}`.slice(0, 200),
    projectId: project!.id,
    leadId,
    kind: 'video',
    startAt: new Date(r.start_at).toISOString(),
    durationMinutes: type.duration,
    externalEmails: [r.email],
    location: type.location,
    source: 'booking',
    bookingReservationId: r.id,
    notifications: [{ channel: 'in_app', minutes: 30 }],
  });
  return meeting;
}

/** In-app notice for the host and a confirmation email for the guest (the management link is never emailed). */
export async function bookingEvent(event: 'created' | 'rescheduled' | 'cancelled', reservationId: string, actorIsHost = false) {
  const r = await one(
    `SELECT r.*, t.title, t.timezone, m.id AS meeting_id FROM booking_reservations r
       JOIN booking_types t ON t.id=r.booking_type_id LEFT JOIN meetings m ON m.booking_reservation_id=r.id WHERE r.id=$1`,
    [reservationId],
  );
  if (!r) return;
  const when = fmt(new Date(r.start_at), r.timezone);
  const verb = { created: 'New booking', rescheduled: 'Booking rescheduled', cancelled: 'Booking cancelled' }[event];
  if (!actorIsHost)
    await notify({
      userId: r.host_id,
      kind: 'booking',
      title: `${verb}: ${r.name}`,
      body: `${r.title} · ${when}`,
      link: r.meeting_id ? `/meetings/${r.meeting_id}` : '/meetings',
    });
  const guestText = {
    created: `Hi ${r.name},\n\nYour ${r.title} is confirmed for ${when}.\n\nUse the private link you saved when booking to reschedule or cancel.`,
    rescheduled: `Hi ${r.name},\n\nYour ${r.title} has moved to ${when}.`,
    cancelled: `Hi ${r.name},\n\nYour ${r.title} on ${when} has been cancelled.`,
  }[event];
  await queueMail({
    to: r.email,
    subject: `${verb}: ${r.title}`,
    text: guestText,
    category: 'booking',
    relatedEntity: 'booking',
    relatedId: r.id,
  });
}

/** Keeps the linked meeting in step with its reservation. */
export async function onBookingChanged(reservationId: string) {
  const r = await one('SELECT * FROM booking_reservations WHERE id=$1', [reservationId]);
  const m = await one('SELECT id FROM meetings WHERE booking_reservation_id=$1', [reservationId]);
  if (!r || !m) return;
  if (r.status === 'cancelled') await query(`UPDATE meetings SET status='cancelled', updated_at=now() WHERE id=$1`, [m.id]);
  else
    await query(`UPDATE meetings SET start_at=$2, duration_minutes=$3, updated_at=now() WHERE id=$1`, [
      m.id,
      r.start_at,
      Math.round((new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / MIN),
    ]);
  await syncNotices(m.id);
}

/** Cancelling a booked meeting from the CRM also frees the reservation. */
export async function cancelReservationForMeeting(reservationId: string) {
  const r = await one(
    `UPDATE booking_reservations SET status='cancelled', updated_at=now() WHERE id=$1 AND status='confirmed' RETURNING id`,
    [reservationId],
  );
  if (r) await bookingEvent('cancelled', r.id, true);
}
