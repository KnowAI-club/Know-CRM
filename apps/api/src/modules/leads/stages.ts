import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { currentUser, requireAdmin, requireStaff } from '../../middleware/auth.js';

/** Lead pipeline stages and the shared source/industry option lists. */
export const router = Router();

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour')
  .transform((c) => c.toLowerCase());
const stageFields = z.object({
  label: z.string().trim().min(1, 'Required').max(100),
  kind: z.enum(['open', 'won']),
  projectStageId: z.string().nullable().default(null),
  color,
});

export const stageCatalog = () =>
  many(
    `SELECT s.*, ps.label AS project_stage_label,
       (SELECT count(*)::int FROM leads l WHERE l.stage = s.id) AS lead_count,
       EXISTS (SELECT 1 FROM lead_nurture n WHERE n.entry_stage = s.id) AS used_by_nurture
     FROM lead_stages s LEFT JOIN project_stages ps ON ps.id = s.project_stage_id
     ORDER BY s.position`,
  );

async function checkHandoff(kind: string, projectStageId: string | null) {
  if (kind === 'open') {
    if (projectStageId) throw badRequest('Open stages cannot create projects.');
    return;
  }
  if (!projectStageId) throw badRequest('Choose the project stage won leads move into.');
  const ps = await one('SELECT category FROM project_stages WHERE id=$1', [projectStageId]);
  if (!ps || ['completed', 'archived'].includes(ps.category)) throw badRequest('Choose an active project stage as the destination.');
}

router.get('/lead-stages', requireStaff, async (_req, res) => res.json(await stageCatalog()));

router.post('/lead-stages', requireAdmin, async (req, res) => {
  const data = parse(stageFields, req.body);
  await checkHandoff(data.kind, data.projectStageId);
  const stage = await transaction(async () => {
    await query('LOCK TABLE lead_stages IN EXCLUSIVE MODE');
    const n = await one<{ n: number }>('SELECT count(*)::int n FROM lead_stages');
    if ((n?.n ?? 0) >= 50) throw badRequest('Use 50 stages or fewer.');
    if (await one('SELECT 1 FROM lead_stages WHERE lower(label)=lower($1)', [data.label]))
      throw conflict('A stage with this label already exists.');
    return one(
      `INSERT INTO lead_stages(id,label,color,kind,project_stage_id,position)
       VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(position)+1,0) FROM lead_stages)) RETURNING *`,
      [`stage_${randomUUID().replace(/-/g, '')}`, data.label, data.color, data.kind, data.projectStageId],
    );
  });
  await audit(currentUser(req), 'lead_stage', null, 'created', `Lead stage ${data.label} created`);
  res.status(201).json(stage);
});

router.put('/lead-stages/order', requireAdmin, async (req, res) => {
  const { stageIds } = parse(z.object({ stageIds: z.array(z.string()).min(1).max(50) }), req.body);
  await transaction(async () => {
    const ids = (await many('SELECT id FROM lead_stages')).map((r) => r.id);
    if (ids.length !== stageIds.length || new Set(stageIds).size !== ids.length || !ids.every((id) => stageIds.includes(id)))
      throw badRequest('Include every stage exactly once when reordering.');
    for (const [i, id] of stageIds.entries()) await query('UPDATE lead_stages SET position=$2 WHERE id=$1', [id, i]);
  });
  await audit(currentUser(req), 'lead_stage', null, 'reordered', 'Lead stages reordered');
  res.json(await stageCatalog());
});

router.patch('/lead-stages/:id', requireAdmin, async (req, res) => {
  const data = parse(stageFields.partial(), req.body);
  const stage = await transaction(async () => {
    const current = (await stageCatalog()).find((s) => s.id === req.params.id);
    if (!current) throw notFound('Stage');
    const kind = data.kind ?? current.kind;
    const projectStageId =
      data.projectStageId !== undefined ? data.projectStageId : kind === current.kind ? current.project_stage_id : null;
    if (kind !== current.kind && (current.system || current.lead_count > 0 || current.used_by_nurture))
      throw conflict('Only unused custom stages can change behaviour.');
    await checkHandoff(kind, projectStageId);
    if (data.label && (await one('SELECT 1 FROM lead_stages WHERE lower(label)=lower($1) AND id<>$2', [data.label, current.id])))
      throw conflict('A stage with this label already exists.');
    return one('UPDATE lead_stages SET label=$2, color=$3, kind=$4, project_stage_id=$5 WHERE id=$1 RETURNING *', [
      current.id,
      data.label ?? current.label,
      data.color ?? current.color,
      kind,
      projectStageId,
    ]);
  });
  await audit(currentUser(req), 'lead_stage', null, 'updated', `Lead stage ${stage!.label} updated`);
  res.json(stage);
});

router.delete('/lead-stages/:id', requireAdmin, async (req, res) => {
  const label = await transaction(async () => {
    const current = (await stageCatalog()).find((s) => s.id === req.params.id);
    if (!current) throw notFound('Stage');
    if (current.system) throw conflict('System stages cannot be deleted.');
    if (current.lead_count > 0 || current.used_by_nurture) throw conflict('Move every lead out of this stage before deleting it.');
    await query('DELETE FROM lead_stages WHERE id=$1', [current.id]);
    await query('UPDATE lead_stages SET position = position - 1 WHERE position > $1', [current.position]);
    return current.label;
  });
  await audit(currentUser(req), 'lead_stage', null, 'deleted', `Lead stage ${label} deleted`);
  res.status(204).end();
});

// ── Shared option lists (sources, industries) ────────────────────────────────
const kindParam = z.object({ kind: z.enum(['source', 'industry']) });

router.get('/lead-options', requireStaff, async (_req, res) => {
  res.json(
    await many(
      `SELECT o.kind, o.label,
         (SELECT count(*)::int FROM leads l WHERE lower(l.data->>o.kind) = lower(o.label)) AS lead_count
       FROM lead_options o ORDER BY o.kind, lower(o.label)`,
    ),
  );
});

router.post('/lead-options', requireStaff, async (req, res) => {
  const data = parse(kindParam.extend({ label: z.string().trim().min(1, 'Required').max(300) }), req.body);
  const existing = await one('SELECT kind, label FROM lead_options WHERE kind=$1 AND lower(label)=lower($2)', [data.kind, data.label]);
  if (existing) return void res.status(200).json(existing);
  const row = await one('INSERT INTO lead_options(kind,label) VALUES($1,$2) RETURNING kind, label', [data.kind, data.label]);
  await audit(currentUser(req), 'lead_option', null, 'created', `${data.kind} ${data.label} added`);
  res.status(201).json(row);
});

router.delete('/lead-options/:kind/:label', requireAdmin, async (req, res) => {
  const { kind } = parse(kindParam, req.params);
  const label = String(req.params.label);
  const row = await one('SELECT label FROM lead_options WHERE kind=$1 AND lower(label)=lower($2)', [kind, label]);
  if (!row) throw notFound('Option');
  const used = await one(`SELECT 1 FROM leads WHERE lower(data->>$1) = lower($2) LIMIT 1`, [kind, row.label]);
  if (used) throw conflict(`Move all leads out of this ${kind} before deleting it.`);
  await query('DELETE FROM lead_options WHERE kind=$1 AND label=$2', [kind, row.label]);
  await audit(currentUser(req), 'lead_option', null, 'deleted', `${kind} ${row.label} deleted`);
  res.status(204).end();
});
