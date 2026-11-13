import { z } from 'zod';
import { EXIT_STATUSES, GSTIN_PATTERN, NURTURE_TAGS } from '@know-crm/shared';
import { many, one, query } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { leadHistory, projectActivity } from '../../lib/activity.js';
import { notify } from '../../lib/notify.js';
import { workspaceCurrency } from '../../lib/settings.js';
import type { SessionUser } from '../../middleware/auth.js';
import { ensureContact } from '../contacts/service.js';

const short = z.string().trim().max(300).default('');
const long = z.string().trim().max(10000).default('');
const url = z
  .union([z.literal(''), z.string().trim().url('Enter a full link starting with https://').max(2000)])
  .default('')
  .refine((v) => !v || /^https?:\/\//i.test(v), 'Use an http(s) link.');

/** Lead profile stored in leads.data. Unknown keys are dropped. */
export const dataSchema = z.object({
  funnel: z.enum(['inbound', 'outbound']).default('inbound'),
  temperature: z.enum(['warm', 'cold']).default('warm'),
  company: short,
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+()\-. ]*$/, 'Use digits, spaces and + ( ) - only.')
    .default(''),
  website: url,
  socials: long,
  budget: short,
  timeline: short,
  industry: short,
  source: short,
  ownerId: z.union([z.literal(''), z.string().uuid()]).default(''),
  problem: long,
  goals: long,
  description: long,
  wants: long,
  notes: long,
  utmSource: short,
  utmMedium: short,
  utmCampaign: short,
  qualifiedFit: z.enum(['unknown', 'yes', 'no']).default('unknown'),
  attendance: z.enum(['unknown', 'yes', 'no']).default('unknown'),
  outcome: z.enum(['none', 'ideal', 'no_show', 'ghost', 'refused']).default('none'),
  billingName: short,
  billingEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]).default(''),
  billingAddress: long,
  taxId: short,
});
export type LeadData = z.infer<typeof dataSchema>;

export const nurtureTag = z.enum(NURTURE_TAGS);
export const exitStatus = z.enum(EXIT_STATUSES);

export interface Stage {
  id: string;
  label: string;
  color: string;
  position: number;
  system: boolean;
  kind: 'open' | 'won';
  project_stage_id: string | null;
}

export const stages = () => many<Stage & Record<string, any>>('SELECT * FROM lead_stages ORDER BY position');

export async function firstOpenStage() {
  const s = await one<Stage>(`SELECT * FROM lead_stages WHERE kind='open' ORDER BY position LIMIT 1`);
  if (!s) throw conflict('Configure an open lead stage in Settings.');
  return s;
}

/** Moving to or past the Qualified stage marks the lead as a qualified fit. */
export async function applyQualifiedFit(stageId: string, data: LeadData) {
  const row = await one<{ reached: boolean }>(
    `SELECT (SELECT position FROM lead_stages WHERE id=$1) >=
            (SELECT position FROM lead_stages WHERE id='qualified' OR lower(label)='qualified' ORDER BY position LIMIT 1) AS reached`,
    [stageId],
  );
  if (row?.reached) data.qualifiedFit = 'yes';
}

/** Owners must be active team members; source/industry must exist in the shared lists. */
export async function validateLeadData(data: LeadData, previous?: LeadData) {
  if (data.ownerId && data.ownerId !== previous?.ownerId) {
    const u = await one(`SELECT 1 FROM users WHERE id=$1 AND role <> 'client' AND disabled_at IS NULL`, [data.ownerId]);
    if (!u) throw badRequest('Choose an active team member as the owner.');
  }
  for (const kind of ['source', 'industry'] as const) {
    const label = data[kind];
    if (!label || label === previous?.[kind]) continue;
    const opt = await one<{ label: string }>('SELECT label FROM lead_options WHERE kind=$1 AND lower(label)=lower($2)', [kind, label]);
    if (!opt) throw badRequest(`Add this ${kind} to the shared options first.`);
    data[kind] = opt.label;
  }
}

/** Two working days (Mon–Fri, India time) after `from`, at the same local time. */
export function confirmationDueAt(from = new Date()) {
  const offset = 330 * 60_000;
  const local = new Date(from.getTime() + offset);
  let added = 0;
  while (added < 2) {
    local.setUTCDate(local.getUTCDate() + 1);
    const day = local.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return new Date(local.getTime() - offset);
}

export const LEAD_SELECT = `
  SELECT l.*, n.entry_stage, n.reason AS nurture_reason, n.entered_at, w.won_at,
    CASE WHEN n.lead_id IS NULL THEN NULL ELSE to_jsonb(n) || jsonb_build_object(
      'owner_name', (SELECT name FROM users WHERE id=n.owner_id),
      'confirmed_by_name', (SELECT name FROM users WHERE id=n.confirmed_by)) END AS nurture,
    (SELECT name FROM users WHERE id::text = l.data->>'ownerId') AS owner_name,
    p.name AS project_name,
    (ps.category = 'archived') AS project_archived
  FROM leads l
  LEFT JOIN lead_nurture n ON n.lead_id = l.id
  LEFT JOIN lead_won w ON w.lead_id = l.id
  LEFT JOIN projects p ON p.id = l.project_id
  LEFT JOIN project_stages ps ON ps.id = p.stage`;

export async function getLead(id: string) {
  const lead = await one(`${LEAD_SELECT} WHERE l.id=$1`, [id]);
  if (!lead) throw notFound('Lead');
  return lead;
}

export function assertVersion(lead: { version: number }, version: number) {
  if (lead.version !== version) throw conflict('This lead changed. Reload before saving.');
}

export interface NurtureEntry {
  reason: string;
  tags?: string[];
  ownerId?: string;
  revisitDate?: string | null;
}

/** Validates the parked-nurture fields shared by exit, nurture and nurture management. */
export async function validateNurture(
  lead: { data: LeadData },
  body: NurtureEntry & { exitStatus?: string; resumeDate?: string | null },
  archived: boolean,
) {
  const reason = body.reason?.trim();
  if (!reason) throw badRequest('Add a reason.');
  const tags = [...new Set(body.tags ?? [])];
  if (!archived && (tags.length < 1 || tags.length > 3)) throw badRequest('Choose at least one nurture tag.');
  const ownerId = body.ownerId || lead.data.ownerId;
  if (!ownerId) throw badRequest('Assign a POC for this lead.');
  const owner = await one(`SELECT 1 FROM users WHERE id=$1 AND role <> 'client' AND disabled_at IS NULL`, [ownerId]);
  if (!owner) throw badRequest('Assign a POC for this lead.');
  const revisitDate = body.revisitDate || null;
  if (!archived && !revisitDate && (tags.includes('not_ready') || body.exitStatus === 'on_hold')) throw badRequest('Add a revisit date.');
  if (revisitDate && body.resumeDate && revisitDate !== body.resumeDate) throw badRequest('Revisit and resume dates must match.');
  return { reason, tags: archived ? ['archived'] : tags, ownerId, revisitDate };
}

/** Creates the lead_nurture row when a lead leaves the active pipeline. */
export async function enterNurture(
  lead: { id: string; name: string; stage: string; data: LeadData },
  entry: Awaited<ReturnType<typeof validateNurture>>,
  archived: boolean,
) {
  await query('DELETE FROM lead_nurture WHERE lead_id=$1', [lead.id]);
  await query(
    `INSERT INTO lead_nurture(lead_id, entry_stage, reason, status, tags, owner_id, revisit_date,
       confirmation_due_at, archived_at, archive_reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      lead.id,
      lead.stage,
      entry.reason,
      archived ? 'archived' : 'parked',
      entry.tags,
      entry.ownerId,
      entry.revisitDate,
      archived ? null : confirmationDueAt(),
      archived ? new Date() : null,
      archived ? entry.reason : '',
    ],
  );
  if (!archived)
    await notify({
      userId: entry.ownerId,
      kind: 'nurture_review',
      title: `Assess nurture: ${lead.name}`,
      link: '/nurtures',
    });
  lead.data.ownerId = entry.ownerId;
}

/** Ends the active nurture sequence assignment, if any. */
export async function endAssignment(leadId: string, reason: string) {
  await query(`UPDATE nurture_assignments SET status='ended', ended_at=now(), end_reason=$2 WHERE lead_id=$1 AND status='active'`, [
    leadId,
    reason,
  ]);
}

/**
 * Close won: links (or creates) the client contact and project, moves open
 * lead tasks and meetings across, and records project activity.
 */
export async function convertWonLead(
  actor: SessionUser,
  lead: { id: string; name: string; email: string; project_id: string | null; data: LeadData },
  destinationStage: string,
  opts: { dueDate: string; value?: number },
) {
  if (lead.project_id) return lead.project_id;
  const d = lead.data;
  const origin = ['Website', 'Booking', 'Lead form'].includes(d.source) ? 'Website' : 'Manual';
  const contact = await ensureContact(
    { name: lead.name, email: lead.email, company: d.company, phone: d.phone, website: d.website },
    origin,
  );
  const taxId = d.taxId.trim().toUpperCase();
  const gstin = GSTIN_PATTERN.test(taxId) ? taxId : '';
  await query(
    `UPDATE contacts SET
       billing_name = CASE WHEN billing_name='' THEN $2 ELSE billing_name END,
       billing_address = CASE WHEN billing_address='' THEN $3 ELSE billing_address END,
       billing_email = CASE WHEN billing_email='' THEN $4 ELSE billing_email END,
       pan = CASE WHEN $5 <> '' AND gstin='' AND pan='' THEN substr($5, 3, 10) ELSE pan END,
       gstin = CASE WHEN gstin='' THEN $5 ELSE gstin END,
       updated_at = now()
     WHERE id=$1`,
    [contact.id, d.billingName, d.billingAddress, d.billingEmail, gstin],
  );

  const intake = await many<{ id: string }>(
    `SELECT p.id FROM projects p
       JOIN contacts c ON c.id = p.contact_id
       JOIN project_stages s ON s.id = p.stage
      WHERE lower(c.email) = lower($1) AND p.phase = 'intake' AND s.category = 'inquiry'
        AND NOT EXISTS (SELECT 1 FROM leads x WHERE x.project_id = p.id)`,
    [lead.email],
  );
  if (intake.length > 1) throw conflict('Multiple intake projects exist for this email. Archive the extras before closing won.');

  let projectId: string;
  let reused = false;
  if (intake.length === 1) {
    projectId = intake[0]!.id;
    reused = true;
    await query(
      `UPDATE projects SET phase='delivery', stage=$2, stage_changed_at=now(), due_date=COALESCE($3, due_date),
         value=COALESCE($4, value), updated_at=now() WHERE id=$1`,
      [projectId, destinationStage, opts.dueDate, opts.value ?? null],
    );
  } else {
    const owner = d.ownerId
      ? await one(`SELECT id FROM users WHERE id=$1 AND role <> 'client' AND disabled_at IS NULL`, [d.ownerId])
      : null;
    const created = await one<{ id: string }>(
      `INSERT INTO projects(name, contact_id, stage, value, currency, description, due_date, owner_id, lead_source)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        `${d.company || lead.name} - Project`.slice(0, 500),
        contact.id,
        destinationStage,
        opts.value ?? 0,
        await workspaceCurrency(),
        d.goals || d.problem || d.description || '',
        opts.dueDate,
        owner?.id ?? actor.id,
        d.source.slice(0, 100),
      ],
    );
    projectId = created!.id;
  }

  await query('UPDATE leads SET project_id=$2, contact_id=$3 WHERE id=$1', [lead.id, projectId, contact.id]);
  const moved = await query('UPDATE tasks SET lead_id=NULL, project_id=$2 WHERE lead_id=$1 AND NOT completed', [lead.id, projectId]);
  await query('UPDATE meetings SET project_id=$2 WHERE lead_id=$1', [lead.id, projectId]);
  const n = moved.rowCount ?? 0;
  await projectActivity(
    actor,
    projectId,
    `Lead closed won: ${lead.name}. ${reused ? 'Existing intake project linked.' : 'Project created.'}` +
      (n ? ` ${n} open lead task${n === 1 ? '' : 's'} moved here.` : '') +
      ' Sales history is available from the linked lead.',
  );
  return projectId;
}

/** Only admins may change a lead's phone number once set. */
export function assertPhoneChange(user: SessionUser, before: LeadData, after: LeadData) {
  if (user.role !== 'admin' && before.phone !== after.phone) throw forbidden("Only an admin can change a client's phone.");
}

export interface CycleSegment {
  stage: string;
  nurture: boolean;
  start: string;
  end: string;
}

/** Splits a lead's life into stage and nurture segments from its history. */
export async function leadCycle(leadId: string) {
  const lead = await one('SELECT l.*, w.won_at FROM leads l LEFT JOIN lead_won w ON w.lead_id=l.id WHERE l.id=$1', [leadId]);
  if (!lead) throw notFound('Lead');
  const history = await many('SELECT action, detail, created_at FROM lead_history WHERE lead_id=$1 ORDER BY created_at, id', [leadId]);
  const firstMove = history.find((h) => h.detail?.previousStage);
  let stage: string = firstMove?.detail.previousStage ?? lead.stage;
  let nurture = false;
  let start = new Date(lead.created_at).toISOString();
  const end = lead.won_at ? new Date(lead.won_at).toISOString() : new Date().toISOString();
  const segments: CycleSegment[] = [];
  const cut = (at: string) => {
    if (at > start) segments.push({ stage, nurture, start, end: at });
    start = at;
  };
  for (const h of history) {
    const at = new Date(h.created_at).toISOString();
    const d = h.detail ?? {};
    if (h.action === 'won') break;
    const entering = h.action === 'nurture' || h.action === 'nurture_repark' || (h.action === 'exit' && d.to === 'nurture');
    const leaving = nurture && ['restore', 'reply', 'nurture_archive'].includes(h.action);
    if (entering && !nurture) {
      cut(at);
      nurture = true;
    } else if (leaving) {
      cut(at);
      nurture = false;
      if (d.stage) stage = d.stage;
    } else if (d.stage && d.stage !== stage) {
      cut(at);
      stage = d.stage;
    }
  }
  cut(end);
  const merged: CycleSegment[] = [];
  for (const s of segments) {
    const last = merged.at(-1);
    if (last && last.stage === s.stage && last.nurture === s.nurture) last.end = s.end;
    else merged.push({ ...s });
  }
  return {
    createdAt: lead.created_at,
    wonAt: lead.won_at,
    wonStage: lead.state === 'won' ? lead.stage : null,
    segments: merged,
  };
}

export { leadHistory };
