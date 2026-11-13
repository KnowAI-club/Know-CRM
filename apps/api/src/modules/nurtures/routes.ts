import { Router } from 'express';
import { z } from 'zod';
import { fillMerge } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, notFound, HttpError } from '../../lib/errors.js';
import { leadHistory } from '../../lib/activity.js';
import { getSettings } from '../../lib/settings.js';
import { sendNow } from '../../lib/mail.js';
import { rateLimit } from '../../middleware/security.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { ensureContact } from '../contacts/service.js';
import { firstOpenStage } from '../leads/service.js';
import { nextAction, plan, type PlanCell, type SeqEmail, type Step } from './schedule.js';

export const router = Router();
router.use('/nurtures', requireStaff);

const uuid = z.string().uuid();
const idOf = (v: unknown) => parse(uuid, v);

// ── Loading ──────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
type SequenceRow = Row & { weekly_cap: boolean; stop_on_reply: boolean; emails: (SeqEmail & Row)[] };
type Tracked = Row & {
  plan: PlanCell[];
  next: ReturnType<typeof nextAction>;
  step: number;
  total: number;
  last_email_at: string;
};

async function sequencesWithEmails(ids?: string[]): Promise<SequenceRow[]> {
  const seqs = await many(
    `SELECT * FROM nurture_sequences ${ids ? 'WHERE id = ANY($1::uuid[])' : ''} ORDER BY position, created_at`,
    ids ? [ids] : [],
  );
  const emails = await many<SeqEmail & Record<string, any>>(
    'SELECT * FROM nurture_sequence_emails WHERE sequence_id = ANY($1::uuid[]) ORDER BY sequence_id, position',
    [seqs.map((s) => s.id)],
  );
  return seqs.map((s) => ({ ...s, emails: emails.filter((e) => e.sequence_id === s.id) }) as SequenceRow);
}

/** Assignments (with lead, plan and next step) matching a SQL filter. */
async function trackedLeads(where: string, params: unknown[] = []): Promise<Tracked[]> {
  const rows = await many(
    `SELECT a.*, l.name, l.email, l.data->>'company' AS company, l.state,
            n.discarded_at, n.discard_reason, n.source, s.name AS sequence_name
       FROM nurture_assignments a
       JOIN leads l ON l.id = a.lead_id
       JOIN nurture_sequences s ON s.id = a.sequence_id
       LEFT JOIN lead_nurture n ON n.lead_id = l.id
      WHERE ${where}
      ORDER BY a.started_at DESC LIMIT 2000`,
    params,
  );
  if (!rows.length) return [];
  const seqs = await sequencesWithEmails([...new Set(rows.map((r) => r.sequence_id))]);
  const steps = await many<Step & { assignment_id: string }>(
    'SELECT * FROM nurture_assignment_steps WHERE assignment_id = ANY($1::uuid[])',
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => {
    const seq = seqs.find((s) => s.id === r.sequence_id)!;
    const cells = plan(
      { started_at: r.started_at, paused_at: r.paused_at ?? r.discarded_at },
      seq,
      seq.emails,
      steps.filter((s) => s.assignment_id === r.id),
    );
    const sent = cells.filter((c) => c.sent_at);
    const lastSent = sent
      .map((c) => c.sent_at!)
      .sort()
      .at(-1);
    return {
      ...r,
      plan: cells,
      next: nextAction(cells),
      step: Math.max(1, sent.length),
      total: cells.length,
      last_email_at: lastSent ?? cells[0]?.due_at ?? r.started_at,
    };
  });
}

const PARKED = `l.state='nurture' AND n.status='parked'`;
const ACTIVE_ASSIGNMENT = `EXISTS (SELECT 1 FROM nurture_assignments a WHERE a.lead_id=l.id AND a.status='active')`;

async function generalList() {
  return many(
    `SELECT l.id, l.name, l.email, l.data->>'company' AS company, l.data->>'industry' AS industry, l.version,
            n.source, n.reason, n.tags, n.entered_at, n.revisit_date, n.owner_id, u.name AS owner_name
       FROM leads l JOIN lead_nurture n ON n.lead_id = l.id LEFT JOIN users u ON u.id = n.owner_id
      WHERE ${PARKED} AND n.discarded_at IS NULL AND NOT ${ACTIVE_ASSIGNMENT}
      ORDER BY n.entered_at DESC`,
  );
}

function sequenceStats(seq: SequenceRow, tracked: Tracked[]) {
  const mine = tracked.filter((t) => t.sequence_id === seq.id && t.status === 'active');
  const replied = mine.filter((t) => t.next.kind === 'reply').length;
  return {
    leads: mine.length,
    sent: mine.reduce((n, t) => n + t.plan.filter((c) => c.sent_at).length, 0),
    replied,
    due: mine.filter((t) => t.next.kind === 'send').length,
    replyRate: mine.length ? Math.round((replied / mine.length) * 100) : 0,
    emails: seq.emails.length,
    perEmail: Object.fromEntries(
      seq.emails.map((e) => [
        e.id,
        {
          sent: mine.filter((t) => t.plan.some((c) => c.email_id === e.id && c.sent_at)).length,
          replied: mine.filter((t) => t.plan.some((c) => c.email_id === e.id && c.replied_at)).length,
          due: mine.filter((t) => t.next.kind === 'send' && 'emailId' in t.next && t.next.emailId === e.id).length,
        },
      ]),
    ),
  };
}

async function sequenceCards() {
  const seqs = await sequencesWithEmails();
  const tracked = await trackedLeads(`a.status='active'`);
  return seqs.map((s) => ({
    ...s,
    last_day: s.emails.at(-1)?.day ?? 0,
    stats: sequenceStats(s, tracked),
  }));
}

// ── Overview & lists ─────────────────────────────────────────────────────────
router.get('/nurtures/counts', async (_req, res) => {
  res.json(
    await one(
      `SELECT
         count(*) FILTER (WHERE n.discarded_at IS NULL AND NOT ${ACTIVE_ASSIGNMENT})::int AS general,
         count(*) FILTER (WHERE n.discarded_at IS NULL AND ${ACTIVE_ASSIGNMENT})::int AS tracking,
         count(*) FILTER (WHERE n.discarded_at IS NOT NULL)::int AS discard,
         (SELECT count(*)::int FROM leads WHERE state='dropped') AS archived
       FROM leads l JOIN lead_nurture n ON n.lead_id = l.id WHERE ${PARKED}`,
    ),
  );
});

router.get('/nurtures/overview', async (_req, res) => {
  const [cards, general, back] = await Promise.all([
    sequenceCards(),
    generalList(),
    one<{ n: number }>(
      `SELECT count(*)::int n FROM lead_history WHERE action IN ('restore','reply') AND detail->>'from' = 'nurture'
         AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
    ),
  ]);
  res.json({
    stats: {
      parked: general.length,
      inSequence: cards.reduce((n, c) => n + c.stats.leads, 0),
      replied: cards.reduce((n, c) => n + c.stats.replied, 0),
      backThisMonth: back?.n ?? 0,
    },
    sequences: cards,
  });
});

router.get('/nurtures/general', async (_req, res) => {
  res.json({
    leads: await generalList(),
    sequences: (await sequencesWithEmails()).map(({ emails, ...s }) => ({ ...s, email_count: emails.length })),
  });
});

router.get('/nurtures/tracking', async (_req, res) => {
  const [rows, sequences] = await Promise.all([
    trackedLeads(`a.status='active' AND l.state='nurture'`),
    many('SELECT id, name, status FROM nurture_sequences ORDER BY position'),
  ]);
  res.json({ rows, sequences });
});

router.get('/nurtures/discard', async (_req, res) => {
  const rows = await trackedLeads(
    `n.discarded_at IS NOT NULL AND ${PARKED} AND a.id = (SELECT id FROM nurture_assignments x WHERE x.lead_id=l.id ORDER BY started_at DESC LIMIT 1)`,
  );
  const withoutSequence = await many(
    `SELECT l.id AS lead_id, l.name, l.email, l.data->>'company' AS company, n.discarded_at, n.discard_reason
       FROM leads l JOIN lead_nurture n ON n.lead_id=l.id
      WHERE n.discarded_at IS NOT NULL AND ${PARKED} AND NOT EXISTS (SELECT 1 FROM nurture_assignments a WHERE a.lead_id=l.id)`,
  );
  res.json({ rows: [...rows, ...withoutSequence].sort((a, b) => +new Date(b.discarded_at) - +new Date(a.discarded_at)) });
});

// ── Sequences ────────────────────────────────────────────────────────────────
const senderName = z
  .string()
  .trim()
  .max(80)
  .regex(/^[^"<>\r\n]*$/, 'Sender name cannot contain quotes, < > or line breaks.');
const sequenceSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the sequence.').max(100),
    description: z.string().trim().max(500).default(''),
    status: z.enum(['active', 'draft']).default('active'),
    stopOnReply: z.boolean().default(true),
    weeklyCap: z.boolean().default(true),
    emails: z
      .array(
        z.object({
          id: uuid.optional(),
          day: z.coerce.number().int().min(0).max(365),
          sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
          sender: z.enum(['owner', 'team', 'person']).default('owner'),
          senderName: senderName.default(''),
          subject: z.string().trim().max(300).default(''),
          preview: z.string().trim().max(200).default(''),
          body: z.string().max(20000).default(''),
          signature: z.string().max(2000).default(''),
          note: z.string().max(2000).default(''),
        }),
      )
      .min(1, 'Add at least one email.')
      .max(30, 'Use 30 emails or fewer.'),
  })
  .superRefine((s, ctx) => {
    s.emails.forEach((e, i) => {
      if (i > 0 && e.day < s.emails[i - 1]!.day)
        ctx.addIssue({
          code: 'custom',
          path: ['emails', i, 'day'],
          message: 'Each email must go out on the same day as the one before it or later.',
        });
      if (s.status === 'active' && (!e.subject || !e.body.trim()))
        ctx.addIssue({
          code: 'custom',
          path: ['emails', i],
          message: `Email ${i + 1} needs a subject and a body before the sequence can be active.`,
        });
      if (s.status === 'active' && e.sender === 'person' && !e.senderName)
        ctx.addIssue({ code: 'custom', path: ['emails', i, 'senderName'], message: `Email ${i + 1} needs a sender name.` });
    });
  });

async function saveEmails(sequenceId: string, emails: z.infer<typeof sequenceSchema>['emails']) {
  const existing = new Set((await many('SELECT id FROM nurture_sequence_emails WHERE sequence_id=$1', [sequenceId])).map((r) => r.id));
  for (const e of emails) if (e.id && !existing.has(e.id)) throw badRequest('An email does not belong to this sequence.');
  const keep = emails.filter((e) => e.id).map((e) => e.id);
  await query('DELETE FROM nurture_sequence_emails WHERE sequence_id=$1 AND NOT (id = ANY($2::uuid[]))', [sequenceId, keep]);
  const ids: string[] = [];
  for (const [i, e] of emails.entries()) {
    const values = [
      i,
      e.day,
      e.sendTime,
      e.sender,
      e.sender === 'person' ? e.senderName : '',
      e.subject,
      e.preview,
      e.body,
      e.signature,
      e.note,
    ];
    const row = e.id
      ? await one(
          `UPDATE nurture_sequence_emails SET position=$2, day=$3, send_time=$4, sender=$5, sender_name=$6, subject=$7,
             preview=$8, body=$9, signature=$10, note=$11 WHERE id=$1 RETURNING id`,
          [e.id, ...values],
        )
      : await one(
          `INSERT INTO nurture_sequence_emails(sequence_id, position, day, send_time, sender, sender_name, subject, preview, body, signature, note)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [sequenceId, ...values],
        );
    ids.push(row!.id);
  }
  return ids;
}

router.get('/nurtures/sequences', async (_req, res) => res.json(await sequenceCards()));

router.get('/nurtures/sequences/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const [seq] = await sequencesWithEmails([id]);
  if (!seq) throw notFound('Sequence');
  const leads = await trackedLeads(`a.sequence_id=$1 AND a.status='active'`, [id]);
  res.json({ ...seq, stats: sequenceStats(seq, leads), leads });
});

router.post('/nurtures/sequences', async (req, res) => {
  const data = parse(sequenceSchema, req.body);
  const result = await transaction(async () => {
    const seq = await one(
      `INSERT INTO nurture_sequences(name, description, status, stop_on_reply, weekly_cap, position)
       VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(position)+1,0) FROM nurture_sequences)) RETURNING id`,
      [data.name, data.description, data.status, data.stopOnReply, data.weeklyCap],
    );
    return { id: seq!.id, emails: await saveEmails(seq!.id, data.emails) };
  });
  res.status(201).json(result);
});

router.put('/nurtures/sequences/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const data = parse(sequenceSchema, req.body);
  const result = await transaction(async () => {
    const seq = await one(
      `UPDATE nurture_sequences SET name=$2, description=$3, status=$4, stop_on_reply=$5, weekly_cap=$6, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [id, data.name, data.description, data.status, data.stopOnReply, data.weeklyCap],
    );
    if (!seq) throw notFound('Sequence');
    return { id, emails: await saveEmails(id, data.emails) };
  });
  res.json(result);
});

router.delete('/nurtures/sequences/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (await one('SELECT 1 FROM nurture_assignments WHERE sequence_id=$1 LIMIT 1', [id]))
    throw conflict('Leads have been through this sequence, so it is kept for their history. Set it to Draft instead.');
  const row = await one('DELETE FROM nurture_sequences WHERE id=$1 RETURNING id', [id]);
  if (!row) throw notFound('Sequence');
  res.status(204).end();
});

// ── Assignments ──────────────────────────────────────────────────────────────
router.post('/nurtures/assignments', async (req, res) => {
  const me = currentUser(req);
  const body = parse(
    z
      .object({ leadId: uuid.optional(), leadIds: z.array(uuid).min(1).max(500).optional(), sequenceId: uuid })
      .refine((b) => !!b.leadId !== !!b.leadIds, 'Send leadId or leadIds.'),
    req.body,
  );
  const ids = [...new Set(body.leadIds ?? [body.leadId!])];
  const created = await transaction(async () => {
    const seq = await one('SELECT * FROM nurture_sequences WHERE id=$1', [body.sequenceId]);
    if (!seq) throw notFound('Sequence');
    if (seq.status !== 'active') throw conflict(`${seq.name} is a draft. Make it active before assigning leads.`);
    const out: string[] = [];
    for (const leadId of ids) {
      await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nurture:${leadId}`]);
      const lead = await one(
        `SELECT l.name, l.state, n.status, n.discarded_at FROM leads l LEFT JOIN lead_nurture n ON n.lead_id=l.id WHERE l.id=$1`,
        [leadId],
      );
      if (!lead) throw notFound('Lead');
      if (lead.state !== 'nurture' || lead.status !== 'parked') throw conflict(`${lead.name} is not a parked nurture lead.`);
      if (lead.discarded_at) throw conflict(`${lead.name} is in Discard. Restore it first.`);
      if (await one(`SELECT 1 FROM nurture_assignments WHERE lead_id=$1 AND status='active'`, [leadId]))
        throw conflict(`${lead.name} is already in a sequence.`);
      const before = await one(
        `SELECT 1 FROM nurture_assignment_steps st JOIN nurture_assignments a ON a.id=st.assignment_id
          WHERE a.lead_id=$1 AND a.sequence_id=$2 AND st.sent_at IS NOT NULL LIMIT 1`,
        [leadId, seq.id],
      );
      if (before) throw conflict(`${lead.name} has already had ${seq.name}. Choose a different sequence.`);
      const row = await one('INSERT INTO nurture_assignments(lead_id, sequence_id, created_by) VALUES($1,$2,$3) RETURNING id', [
        leadId,
        seq.id,
        me.id,
      ]);
      await leadHistory(leadId, me.id, 'Added to nurture sequence', { reason: seq.name });
      out.push(row!.id);
    }
    return out;
  });
  res.status(201).json({ id: created[0], ids: created });
});

async function activeAssignment(id: string) {
  const a = await one(
    `SELECT a.*, s.name AS sequence_name FROM nurture_assignments a JOIN nurture_sequences s ON s.id=a.sequence_id WHERE a.id=$1`,
    [id],
  );
  if (!a) throw notFound('Assignment');
  if (a.status !== 'active') throw conflict('This sequence has already ended for the lead.');
  return a;
}

router.post('/nurtures/assignments/:id/remove', async (req, res) => {
  const me = currentUser(req);
  const a = await activeAssignment(idOf(req.params.id));
  await query(`UPDATE nurture_assignments SET status='ended', ended_at=now(), end_reason='removed' WHERE id=$1`, [a.id]);
  await leadHistory(a.lead_id, me.id, 'Removed from nurture sequence', { reason: a.sequence_name });
  res.json({ ok: true });
});

for (const op of ['pause', 'resume'] as const) {
  router.post(`/nurtures/assignments/:id/${op}`, async (req, res) => {
    const me = currentUser(req);
    const a = await activeAssignment(idOf(req.params.id));
    if ((op === 'pause') === !!a.paused_at) throw conflict(op === 'pause' ? 'Already paused.' : 'Not paused.');
    await query('UPDATE nurture_assignments SET paused_at=$2 WHERE id=$1', [a.id, op === 'pause' ? new Date() : null]);
    await leadHistory(a.lead_id, me.id, op === 'pause' ? 'Nurture sequence paused' : 'Nurture sequence resumed', {
      reason: a.sequence_name,
    });
    res.json({ ok: true });
  });
}

router.post('/nurtures/assignments/:id/emails/:emailId', async (req, res) => {
  const me = currentUser(req);
  const body = parse(
    z
      .object({ sent: z.boolean().optional(), replied: z.boolean().optional() })
      .refine((b) => b.sent !== undefined || b.replied !== undefined, 'Nothing to change.'),
    req.body,
  );
  const a = await activeAssignment(idOf(req.params.id));
  const email = await one('SELECT * FROM nurture_sequence_emails WHERE id=$1 AND sequence_id=$2', [
    idOf(req.params.emailId),
    a.sequence_id,
  ]);
  if (!email) throw notFound('Email');
  await transaction(async () => {
    const step = (await one('SELECT * FROM nurture_assignment_steps WHERE assignment_id=$1 AND email_id=$2 FOR UPDATE', [
      a.id,
      email.id,
    ])) ?? {
      sent_at: null,
      replied_at: null,
    };
    let sent = step.sent_at as Date | null;
    let replied = step.replied_at as Date | null;
    if (body.sent === true) sent ??= new Date();
    if (body.sent === false) {
      sent = null;
      replied = null;
    }
    if (body.replied === true) {
      if (!sent) throw conflict('Mark the email sent before recording a reply.');
      replied ??= new Date();
    }
    if (body.replied === false) replied = null;
    await query(
      `INSERT INTO nurture_assignment_steps(assignment_id, email_id, sent_at, replied_at, marked_by) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (assignment_id, email_id) DO UPDATE SET sent_at=$3, replied_at=$4, marked_by=$5`,
      [a.id, email.id, sent, replied, me.id],
    );
    const label = `Email ${email.position + 1} (${email.subject || 'no subject'})`;
    if (!!sent !== !!step.sent_at)
      await leadHistory(a.lead_id, me.id, sent ? 'Nurture email marked sent' : 'Nurture email unmarked', { reason: label });
    if (!!replied !== !!step.replied_at)
      await leadHistory(a.lead_id, me.id, replied ? 'Nurture reply recorded' : 'Nurture reply removed', { reason: label });
  });
  const [row] = await trackedLeads('a.id=$1', [a.id]);
  res.json(row);
});

// ── Discard & restore ────────────────────────────────────────────────────────
router.post('/nurtures/leads/:leadId/discard', async (req, res) => {
  const me = currentUser(req);
  const leadId = idOf(req.params.leadId);
  const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'Add a reason.').max(200) }), req.body);
  await transaction(async () => {
    const n = await one(`SELECT n.* FROM lead_nurture n JOIN leads l ON l.id=n.lead_id WHERE n.lead_id=$1 AND ${PARKED} FOR UPDATE OF n`, [
      leadId,
    ]);
    if (!n) throw conflict('Only parked nurture leads can be discarded.');
    if (n.discarded_at) throw conflict('Already in Discard.');
    await query(
      `UPDATE nurture_assignments SET status='ended', ended_at=now(), end_reason='discarded' WHERE lead_id=$1 AND status='active'`,
      [leadId],
    );
    await query('UPDATE lead_nurture SET discarded_at=now(), discard_reason=$2 WHERE lead_id=$1', [leadId, reason]);
    await leadHistory(leadId, me.id, 'Moved to nurture Discard', { reason });
  });
  res.json({ ok: true });
});

router.post('/nurtures/leads/:leadId/restore', async (req, res) => {
  const me = currentUser(req);
  const leadId = idOf(req.params.leadId);
  await transaction(async () => {
    const n = await one('SELECT * FROM lead_nurture WHERE lead_id=$1 FOR UPDATE', [leadId]);
    if (!n?.discarded_at) throw conflict('This lead is not in Discard.');
    const replied = await one(
      `SELECT 1 FROM nurture_assignment_steps st JOIN nurture_assignments a ON a.id=st.assignment_id WHERE a.lead_id=$1 AND st.replied_at IS NOT NULL LIMIT 1`,
      [leadId],
    );
    await query(
      `UPDATE lead_nurture SET discarded_at=NULL, discard_reason='', entered_at=now(), source = CASE WHEN $2 THEN 'replied' ELSE source END WHERE lead_id=$1`,
      [leadId, !!replied],
    );
    await leadHistory(leadId, me.id, 'Restored to nurture General list');
  });
  res.json({ ok: true });
});

// ── Import (CSV rows parsed on the client, or a single add) ──────────────────
router.post('/nurtures/leads', async (req, res) => {
  const me = currentUser(req);
  const body = parse(
    z.object({
      source: z.enum(['inbound', 'imported', 'replied']).default('imported'),
      leads: z
        .array(
          z.object({
            name: z.string().trim().min(1, 'Name is required').max(200),
            company: z.string().trim().max(200).default(''),
            email: zs.email,
          }),
        )
        .min(1, 'Add at least one lead.')
        .max(1000, 'Import 1000 leads or fewer at a time.'),
    }),
    req.body,
  );
  const stage = await firstOpenStage();
  const ids: string[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const seen = new Set<string>();
  await transaction(async () => {
    for (const row of body.leads) {
      if (seen.has(row.email)) {
        skipped.push({ email: row.email, reason: 'Listed twice' });
        continue;
      }
      seen.add(row.email);
      await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead:${row.email}`]);
      if (await one('SELECT 1 FROM leads WHERE lower(email)=$1', [row.email])) {
        skipped.push({ email: row.email, reason: 'Already a lead' });
        continue;
      }
      const contact = await ensureContact({ name: row.name, email: row.email, company: row.company }, 'Manual');
      const lead = await one(
        `INSERT INTO leads(name, email, state, stage, data, contact_id) VALUES($1,$2,'nurture',$3,$4,$5) RETURNING id`,
        [row.name, row.email, stage.id, JSON.stringify({ company: row.company, ownerId: me.id }), contact.id],
      );
      await query(
        `INSERT INTO lead_nurture(lead_id, entry_stage, reason, status, tags, owner_id, confirmed_at, confirmed_by, source)
         VALUES($1,$2,$3,'parked','{follow_up}',$4,now(),$4,$5)`,
        [lead!.id, stage.id, body.source === 'inbound' ? 'Added in Nurtures' : 'Imported into Nurtures', me.id, body.source],
      );
      await leadHistory(lead!.id, me.id, 'Lead created', { reason: 'Added to Nurtures' });
      ids.push(lead!.id);
    }
  });
  res.status(201).json({ added: ids.length, ids, skipped });
});

router.get('/nurtures/leads/:leadId', async (req, res) => {
  const leadId = idOf(req.params.leadId);
  const [assignment] = await trackedLeads(`a.lead_id=$1 AND a.status='active'`, [leadId]);
  const seq = assignment ? (await sequencesWithEmails([assignment.sequence_id]))[0] : null;
  const sequences = await many(
    `SELECT s.id, s.name, s.description, s.status, (SELECT count(*)::int FROM nurture_sequence_emails e WHERE e.sequence_id=s.id) AS email_count
       FROM nurture_sequences s ORDER BY position`,
  );
  res.json({ assignment: assignment ? { ...assignment, sequence: seq } : null, sequences });
});

// ── Test send (to the signed-in user, via the local SMTP server) ─────────────
router.post('/nurtures/test-email', rateLimit('nurture-test', 1, 10_000), async (req, res) => {
  const me = currentUser(req);
  const body = parse(
    z.object({
      subject: z.string().trim().min(1, 'Add a subject.').max(300),
      body: z.string().min(1, 'Write the email body.').max(20000),
      signature: z.string().max(2000).default(''),
    }),
    req.body,
  );
  const settings = await getSettings();
  const values = {
    first_name: 'Asha',
    company: 'Sample Co',
    industry: 'Retail',
    problem: 'slow manual reporting',
    owner_name: me.name,
    booking_link: settings?.data?.nurture?.bookingLink ?? '',
    contact_number: settings?.data?.nurture?.contactNumber ?? '',
  };
  const text = fillMerge(body.body, values) + (body.signature ? `\n\n--\n${fillMerge(body.signature, values)}` : '');
  try {
    await sendNow({ to: me.email, subject: `[Test] ${fillMerge(body.subject, values)}`, text });
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : 'Could not send the test email.');
  }
  res.json({ sent: true, to: me.email });
});
