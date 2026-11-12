import { Router } from 'express';
import { z } from 'zod';
import { EXIT_LABELS, NURTURE_TAG_LABELS } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { notify, notifyMentions } from '../../lib/notify.js';
import { sendCsv, isoDay } from '../../lib/csv.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { ensureContact } from '../contacts/service.js';
import {
  LEAD_SELECT,
  applyQualifiedFit,
  assertPhoneChange,
  assertVersion,
  confirmationDueAt,
  convertWonLead,
  dataSchema,
  endAssignment,
  enterNurture,
  exitStatus,
  firstOpenStage,
  getLead,
  leadCycle,
  leadHistory,
  nurtureTag,
  validateLeadData,
  validateNurture,
  type LeadData,
} from './service.js';

export const router = Router();
router.use(['/leads', '/lead-notes'], requireStaff);

const idParam = z.object({ id: z.string().uuid() });
const leadId = (req: { params: unknown }) => parse(idParam, req.params).id;
const STATES = ['active', 'nurture', 'won', 'dropped'] as const;
const HANDED_OFF = 'This lead has been handed off. Continue work in its linked project.';

interface LockedLead {
  [key: string]: any;
  id: string;
  name: string;
  email: string;
  state: string;
  stage: string;
  version: number;
  project_id: string | null;
  data: LeadData;
}

/** Locks and loads a lead inside the current transaction. */
async function lockLead(id: string) {
  const lead = await one('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [id]);
  if (!lead) throw notFound('Lead');
  lead.data = dataSchema.parse(lead.data ?? {});
  return lead as LockedLead;
}

router.get('/leads', async (req, res) => {
  const state = typeof req.query.state === 'string' && (STATES as readonly string[]).includes(req.query.state) ? req.query.state : null;
  res.json(
    await many(`${LEAD_SELECT} WHERE ($1::text IS NULL OR l.state = $1) ORDER BY l.created_at DESC LIMIT 5000`, [state]),
  );
});

/** Projects in delivery shown in the Closed won lanes (from leads or created directly). */
router.get('/leads/won-projects', async (_req, res) => {
  res.json(
    await many(
      `SELECT p.id AS project_id, p.name AS project_name, p.value, p.currency, c.name AS client_name, c.company,
         l.id AS lead_id, l.stage AS lead_stage, COALESCE(w.won_at, p.created_at) AS won_at,
         CASE WHEN l.id IS NULL THEN 'direct' ELSE 'lead' END AS source
       FROM projects p
       JOIN contacts c ON c.id = p.contact_id
       JOIN project_stages s ON s.id = p.stage
       LEFT JOIN leads l ON l.project_id = p.id
       LEFT JOIN lead_won w ON w.lead_id = l.id
       WHERE p.phase = 'delivery' AND s.category <> 'archived'
       ORDER BY won_at DESC LIMIT 2000`,
    ),
  );
});

const createSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(300),
  email: zs.email,
  data: z.record(z.string(), z.unknown()).default({}),
});

router.post('/leads', async (req, res) => {
  const me = currentUser(req);
  const body = parse(createSchema, req.body);
  const data = parse(dataSchema, body.data);
  if (!data.ownerId) data.ownerId = me.id;
  const lead = await transaction(async () => {
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead:${body.email}`]);
    if (await one('SELECT 1 FROM leads WHERE lower(email)=$1', [body.email]))
      throw conflict('A lead with this email already exists.');
    await validateLeadData(data);
    const stage = await firstOpenStage();
    const contact = await ensureContact(
      { name: body.name, email: body.email, company: data.company, phone: data.phone, website: data.website },
      'Manual',
    );
    const row = await one(
      'INSERT INTO leads(name,email,stage,data,contact_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [body.name, body.email, stage.id, JSON.stringify(data), contact.id],
    );
    await leadHistory(row!.id, me.id, 'Lead created', { stage: stage.id });
    return getLead(row!.id);
  });
  res.status(201).json(lead);
});

router.get('/leads/export.csv', async (req, res) => {
  const state = typeof req.query.state === 'string' && (STATES as readonly string[]).includes(req.query.state) ? req.query.state : 'active';
  const rows = await many(
    `${LEAD_SELECT.replace('SELECT l.*', 'SELECT l.*, (SELECT label FROM lead_stages WHERE id=l.stage) AS stage_label, (SELECT label FROM lead_stages WHERE id=n.entry_stage) AS entry_label')}
     WHERE l.state=$1 ORDER BY l.created_at DESC`,
    [state],
  );
  const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '');
  sendCsv(
    res,
    `leads-${state}-${isoDay()}.csv`,
    ['Name', 'Email', 'State', 'Stage', 'Entry stage', 'Reason', 'Exit status', 'Resume date', 'Nurture status',
      'Nurture tags', 'Revisit date', 'Parked at', 'Confirmation due', 'Confirmed at', 'Archive reason', 'Company',
      'Industry', 'Source', 'Problem', 'Owner', 'Created'],
    rows.map((l) => [
      l.name, l.email, l.state, l.stage_label, l.entry_label ?? '', l.nurture?.reason ?? l.exit_reason,
      EXIT_LABELS[l.exit_status as keyof typeof EXIT_LABELS] ?? '', day(l.resume_date),
      l.nurture?.status ?? '',
      (l.nurture?.tags ?? []).map((t: string) => NURTURE_TAG_LABELS[t] ?? t).join('; '),
      day(l.nurture?.revisit_date), day(l.nurture?.entered_at), day(l.nurture?.confirmation_due_at),
      day(l.nurture?.confirmed_at), l.nurture?.archive_reason ?? '', l.data.company ?? '', l.data.industry ?? '',
      l.data.source ?? '', l.data.problem ?? '', l.owner_name ?? '', day(l.created_at),
    ]),
  );
});

router.get('/leads/:id', async (req, res) => {
  const id = leadId(req);
  const lead = await getLead(id);
  const [attachments, meetings, history] = await Promise.all([
    many(
      `SELECT a.id, a.title, a.name, a.size, a.mime, a.to_share, a.file_type_id, t.label AS file_type, a.created_at
         FROM lead_attachments a LEFT JOIN file_types t ON t.id = a.file_type_id
        WHERE a.lead_id=$1 ORDER BY a.created_at DESC`,
      [id],
    ),
    many(
      `SELECT id, title, kind, start_at, duration_minutes, status, outcome, source, organizer_id
         FROM meetings WHERE lead_id=$1 ORDER BY start_at DESC LIMIT 50`,
      [id],
    ),
    many(
      `SELECT h.id, h.action, h.detail, h.created_at, COALESCE(u.name, 'System') AS actor_name
         FROM lead_history h LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.lead_id=$1 ORDER BY h.created_at DESC LIMIT 200`,
      [id],
    ),
  ]);
  res.json({ lead, attachments, meetings, history });
});

router.get('/leads/:id/cycle', async (req, res) => res.json(await leadCycle(leadId(req))));

// ── Edit & stage move ────────────────────────────────────────────────────────
const patchSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1, 'Required').max(300).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  stage: z.string().max(64).optional(),
});

router.patch('/leads/:id', async (req, res) => {
  const me = currentUser(req);
  const id = leadId(req);
  const body = parse(patchSchema, req.body);
  await transaction(async () => {
    const lead = await lockLead(id);
    assertVersion(lead, body.version);
    if (lead.state === 'won') throw conflict(HANDED_OFF);
    const data = parse(dataSchema, { ...lead.data, ...(body.data ?? {}) });
    assertPhoneChange(me, lead.data, data);
    await validateLeadData(data, lead.data);
    const stageId = body.stage ?? lead.stage;
    const stage = await one('SELECT * FROM lead_stages WHERE id=$1', [stageId]);
    if (!stage) throw badRequest('Choose an existing stage.');
    const stageChanged = stageId !== lead.stage;
    if (stageChanged && stage.kind === 'won')
      throw conflict('Close this lead as won to create its project and enter onboarding.');
    const hasNurture = await one('SELECT 1 FROM lead_nurture WHERE lead_id=$1', [id]);
    if (hasNurture && data.ownerId !== lead.data.ownerId)
      throw conflict('Change the POC in Nurture management so the new owner can confirm.');
    if (stageChanged && lead.state !== 'active') throw conflict('Bring this lead back to CRM before changing its stage.');
    const first = await firstOpenStage();
    if (!data.ownerId && (stageChanged || lead.data.ownerId) && stageId !== first.id)
      throw badRequest('Assign an owner before moving this lead past New.');
    if (stageChanged) await applyQualifiedFit(stageId, data);

    const name = body.name ?? lead.name;
    const fields = [
      ...(name !== lead.name ? ['name'] : []),
      ...Object.keys(data).filter((k) => JSON.stringify((data as any)[k]) !== JSON.stringify((lead.data as any)[k])),
    ];
    if (!stageChanged && !fields.length) return;
    await query(
      `UPDATE leads SET name=$2, data=$3, stage=$4, version=version+1, updated_at=now(),
         stage_changed_at = CASE WHEN $5 THEN now() ELSE stage_changed_at END WHERE id=$1`,
      [id, name, JSON.stringify(data), stageId, stageChanged],
    );
    if (stageChanged)
      await leadHistory(id, me.id, 'Stage changed', { previousStage: lead.stage, stage: stageId, ...(fields.length ? { fields } : {}) });
    else await leadHistory(id, me.id, 'Lead updated', { fields });
  });
  res.json(await getLead(id));
});

// ── Pipeline actions ─────────────────────────────────────────────────────────
const actionSchema = z.object({
  action: z.enum(['exit', 'nurture', 'archive', 'restore', 'reply', 'won']),
  version: z.number().int(),
  reason: z.string().trim().max(10000).default(''),
  stageId: z.string().max(64).optional(),
  dueDate: zs.date,
  value: z.coerce.number().int().min(0).max(1e11).optional(),
  exitStatus: exitStatus.optional(),
  resumeDate: zs.date,
  tags: z.array(nurtureTag).max(3).optional(),
  ownerId: z.union([z.literal(''), z.string().uuid()]).optional(),
  revisitDate: zs.date,
});

router.post('/leads/:id/action', async (req, res) => {
  const me = currentUser(req);
  const id = leadId(req);
  const body = parse(actionSchema, req.body);
  await transaction(async () => {
    const lead = await lockLead(id);
    if (body.action === 'won' && lead.state === 'won' && lead.project_id) return; // idempotent retry
    assertVersion(lead, body.version);
    if (lead.state === 'won') throw conflict('Won records cannot return to the sales funnel.');

    const prev = { state: lead.state, stage: lead.stage };
    const detail: Record<string, unknown> = { reason: body.reason, from: lead.state };
    let state: string = lead.state;
    let stage: string = lead.stage;
    const exit = {
      status: lead.exit_status as string,
      reason: lead.exit_reason as string,
      resume: lead.resume_date as string | null,
      at: lead.exited_at as Date | null,
    };
    const requireActive = () => {
      if (lead.state !== 'active') throw conflict('Only leads in the pipeline can do this.');
    };
    const requireReason = () => {
      if (!body.reason) throw badRequest('Add a reason.');
    };

    switch (body.action) {
      case 'exit': {
        requireActive();
        if (!body.exitStatus) throw badRequest('Choose an exit status.');
        requireReason();
        if (body.exitStatus === 'on_hold' && !body.resumeDate) throw badRequest('Add a resume date.');
        if (body.exitStatus !== 'on_hold' && body.resumeDate) throw badRequest('Only On hold takes a resume date.');
        const archived = body.exitStatus === 'disqualified';
        const entry = await validateNurture(lead, { ...body, revisitDate: body.revisitDate ?? (archived ? null : body.resumeDate) }, archived);
        await enterNurture(lead, entry, archived);
        state = archived ? 'dropped' : 'nurture';
        exit.status = body.exitStatus;
        exit.reason = body.reason;
        exit.resume = body.resumeDate ?? null;
        exit.at = new Date();
        Object.assign(detail, { tags: entry.tags, ownerId: entry.ownerId, revisitDate: entry.revisitDate, exitStatus: body.exitStatus, resumeDate: exit.resume, entryStage: lead.stage });
        break;
      }
      case 'nurture': {
        requireActive();
        const entry = await validateNurture(lead, body, false);
        await enterNurture(lead, entry, false);
        state = 'nurture';
        Object.assign(detail, { tags: entry.tags, ownerId: entry.ownerId, revisitDate: entry.revisitDate });
        break;
      }
      case 'archive': {
        requireActive();
        requireReason();
        const entry = await validateNurture(lead, { reason: body.reason, ownerId: lead.data.ownerId || me.id }, true);
        await enterNurture(lead, entry, true);
        state = 'dropped';
        exit.reason = body.reason;
        exit.at = new Date();
        break;
      }
      case 'restore':
      case 'reply': {
        if (lead.state === 'nurture' || lead.state === 'dropped') {
          const n = await one('DELETE FROM lead_nurture WHERE lead_id=$1 RETURNING *', [id]);
          if (n) stage = n.entry_stage;
          detail.previousNurture = n ?? null;
          state = 'active';
        } else if (body.action === 'reply') throw conflict('Only parked or archived leads can be brought back.');
        Object.assign(detail, { previousExitStatus: exit.status, previousExitReason: exit.reason, previousResumeDate: exit.resume });
        exit.status = '';
        exit.reason = '';
        exit.resume = null;
        exit.at = null;
        break;
      }
      case 'won': {
        requireActive();
        if (!lead.data.ownerId) throw badRequest('Assign an owner before moving this lead past New.');
        if (!body.dueDate) throw badRequest('Enter the project due date before closing won.');
        const closed = body.stageId
          ? await one(`SELECT * FROM lead_stages WHERE id=$1 AND kind='won'`, [body.stageId])
          : await one(`SELECT * FROM lead_stages WHERE kind='won' ORDER BY position LIMIT 1`);
        if (!closed) throw badRequest('Choose a closed-won stage.');
        const dest = await one('SELECT category FROM project_stages WHERE id=$1', [closed.project_stage_id]);
        if (!dest || ['completed', 'archived'].includes(dest.category))
          throw conflict('Update the project destination for this won stage in Settings.');
        const attachments = await many('SELECT id, title, name, size FROM lead_attachments WHERE lead_id=$1', [id]);
        await query('INSERT INTO lead_won(lead_id, snapshot) VALUES($1,$2) ON CONFLICT (lead_id) DO NOTHING', [
          id,
          JSON.stringify({ ...lead, attachments }),
        ]);
        const projectId = await convertWonLead(me, lead as any, closed.project_stage_id, { dueDate: body.dueDate, value: body.value });
        state = 'won';
        stage = closed.id;
        detail.projectId = projectId;
        break;
      }
    }

    const stageChanged = stage !== prev.stage;
    if (stageChanged) await applyQualifiedFit(stage, lead.data);
    await query(
      `UPDATE leads SET state=$2, stage=$3, data=$4, exit_status=$5, exit_reason=$6, resume_date=$7, exited_at=$8,
         version=version+1, updated_at=now(), stage_changed_at = CASE WHEN $9 THEN now() ELSE stage_changed_at END
       WHERE id=$1`,
      [id, state, stage, JSON.stringify(lead.data), exit.status, exit.reason, exit.resume, exit.at, stageChanged],
    );
    if (prev.state === 'nurture' && state !== 'nurture')
      await endAssignment(id, body.action === 'restore' ? 'pipeline' : body.action);
    detail.to = state;
    if (stageChanged) Object.assign(detail, { previousStage: prev.stage, stage });
    await leadHistory(id, me.id, body.action, detail);
  });
  res.json(await getLead(id));
});

// ── Nurture management ───────────────────────────────────────────────────────
const nurtureSchema = z.object({
  version: z.number().int(),
  operation: z.enum(['save', 'confirm', 'archive', 'repark']),
  tags: z.array(nurtureTag).max(3).optional(),
  ownerId: z.union([z.literal(''), z.string().uuid()]).optional(),
  revisitDate: zs.date,
  reason: z.string().trim().max(10000).default(''),
});

router.patch('/leads/:id/nurture', async (req, res) => {
  const me = currentUser(req);
  const id = leadId(req);
  const body = parse(nurtureSchema, req.body);
  await transaction(async () => {
    const lead = await lockLead(id);
    const n = await one('SELECT * FROM lead_nurture WHERE lead_id=$1 FOR UPDATE', [id]);
    if (!n || !['nurture', 'dropped'].includes(lead.state)) throw conflict('This lead is not in Nurtures.');
    assertVersion(lead, body.version);
    const detail: Record<string, unknown> = { reason: body.reason, from: lead.state, previousNurture: n };
    let state = lead.state;

    if (body.operation === 'confirm') {
      if (n.status !== 'parked') throw conflict('Only parked leads can be confirmed.');
      if (n.owner_id !== me.id) throw forbidden('Only the assigned POC can confirm this nurture.');
      if (n.confirmed_at) throw conflict('This nurture is already confirmed.');
      await query('UPDATE lead_nurture SET confirmed_at=now(), confirmed_by=$2 WHERE lead_id=$1', [id, me.id]);
    } else if (body.operation === 'archive') {
      if (n.status !== 'parked') throw conflict('Use the action for this entry’s current status.');
      if (!body.reason) throw badRequest('Add a reason.');
      await query(
        `UPDATE lead_nurture SET status='archived', archived_at=now(), archive_reason=$2,
           tags = CASE WHEN 'archived' = ANY(tags) THEN tags ELSE array_append(tags, 'archived') END
         WHERE lead_id=$1`,
        [id, body.reason],
      );
      await endAssignment(id, 'archived');
      state = 'dropped';
    } else {
      if ((body.operation === 'save') !== (n.status === 'parked'))
        throw conflict('Use the action for this entry’s current status.');
      const exitStatusNow = lead.exit_status === 'disqualified' ? '' : lead.exit_status;
      const entry = await validateNurture(
        lead,
        { reason: body.reason || n.reason, tags: body.tags ?? n.tags.filter((t: string) => t !== 'archived'), ownerId: body.ownerId || n.owner_id, revisitDate: body.revisitDate !== undefined ? body.revisitDate : n.revisit_date, exitStatus: exitStatusNow },
        false,
      );
      await query(
        `UPDATE lead_nurture SET status='parked', tags=$2, owner_id=$3, reason=$4, revisit_date=$5,
           confirmed_at=NULL, confirmed_by=NULL, confirmation_due_at=$6, archived_at=NULL, archive_reason='',
           entered_at = CASE WHEN $7 THEN now() ELSE entered_at END
         WHERE lead_id=$1`,
        [id, entry.tags, entry.ownerId, entry.reason, entry.revisitDate, confirmationDueAt(), body.operation === 'repark'],
      );
      lead.data.ownerId = entry.ownerId;
      await query(
        `UPDATE leads SET exit_reason=$2, resume_date=$3, exit_status=$4 WHERE id=$1`,
        [id, entry.reason, exitStatusNow === 'on_hold' ? entry.revisitDate : null, exitStatusNow],
      );
      state = 'nurture';
      if (n.owner_id !== entry.ownerId || body.operation === 'repark')
        await enterNotice(entry.ownerId, lead.name);
      Object.assign(detail, { tags: entry.tags, ownerId: entry.ownerId, revisitDate: entry.revisitDate });
    }
    await query('UPDATE leads SET state=$2, data=$3, version=version+1, updated_at=now() WHERE id=$1', [
      id,
      state,
      JSON.stringify(lead.data),
    ]);
    detail.to = state;
    await leadHistory(id, me.id, `nurture_${body.operation}`, detail);
  });
  res.json(await getLead(id));
});

async function enterNotice(ownerId: string, name: string) {
  await notify({ userId: ownerId, kind: 'nurture_review', title: `Assess nurture: ${name}`, link: '/nurtures' });
}

// ── Comments ─────────────────────────────────────────────────────────────────
router.get('/leads/:id/comments', async (req, res) => {
  res.json(
    await many(
      'SELECT id, body, author_id, author_name, created_at FROM lead_comments WHERE lead_id=$1 ORDER BY created_at DESC',
      [leadId(req)],
    ),
  );
});

router.post('/leads/:id/comments', async (req, res) => {
  const me = currentUser(req);
  const id = leadId(req);
  const { body } = parse(z.object({ body: z.string().trim().min(1, 'Write a comment.').max(5000) }), req.body);
  const lead = await one('SELECT name, state FROM leads WHERE id=$1', [id]);
  if (!lead) throw notFound('Lead');
  if (lead.state === 'won') throw conflict(HANDED_OFF);
  const comment = await one(
    'INSERT INTO lead_comments(lead_id, body, author_id, author_name) VALUES($1,$2,$3,$4) RETURNING id, body, author_id, author_name, created_at',
    [id, body, me.id, me.name],
  );
  await notifyMentions({ author: me, after: body, where: `a comment on the lead ${lead.name}`, link: `/leads/${id}?tab=files` });
  res.status(201).json(comment);
});

// ── Notes (allowed in every state, including won) ────────────────────────────
const noteSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  body: z.string().max(20000).default(''),
});
const NOTE_COLUMNS = 'id, lead_id, title, body, author_id, author_name, created_at, updated_at';

router.get('/leads/:id/notes', async (req, res) => {
  res.json(await many(`SELECT ${NOTE_COLUMNS} FROM lead_notes WHERE lead_id=$1 ORDER BY created_at DESC`, [leadId(req)]));
});

router.post('/leads/:id/notes', async (req, res) => {
  const me = currentUser(req);
  const id = leadId(req);
  const data = parse(noteSchema, req.body);
  if (!(await one('SELECT 1 FROM leads WHERE id=$1', [id]))) throw notFound('Lead');
  const note = await one(
    `INSERT INTO lead_notes(lead_id,title,body,author_id,author_name) VALUES($1,$2,$3,$4,$5) RETURNING ${NOTE_COLUMNS}`,
    [id, data.title, data.body, me.id, me.name],
  );
  await leadHistory(id, me.id, 'Note added', { reason: data.title });
  res.status(201).json(note);
});

router.patch('/lead-notes/:id', async (req, res) => {
  const me = currentUser(req);
  const data = parse(noteSchema, req.body);
  const note = await one(
    `UPDATE lead_notes SET title=$2, body=$3, updated_at=now() WHERE id=$1 RETURNING ${NOTE_COLUMNS}`,
    [leadId(req), data.title, data.body],
  );
  if (!note) throw notFound('Note');
  await leadHistory(note.lead_id, me.id, 'Note updated', { reason: data.title });
  res.json(note);
});

router.delete('/lead-notes/:id', async (req, res) => {
  const me = currentUser(req);
  const note = await one('DELETE FROM lead_notes WHERE id=$1 RETURNING lead_id, title', [leadId(req)]);
  if (!note) throw notFound('Note');
  await leadHistory(note.lead_id, me.id, 'Note deleted', { reason: note.title });
  res.status(204).end();
});
