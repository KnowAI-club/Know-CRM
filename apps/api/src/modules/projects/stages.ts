import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { PROJECT_CATEGORIES } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { currentUser, requireAdmin, requireStaff } from '../../middleware/auth.js';

export const router = Router();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour').transform((c) => c.toLowerCase());

const list = () =>
  many(
    `SELECT s.*, (SELECT count(*)::int FROM projects p WHERE p.stage=s.id AND p.phase='delivery') AS project_count
       FROM project_stages s ORDER BY position`,
  );

router.get('/project-stages', requireStaff, async (_req, res) => res.json(await list()));

router.post('/project-stages', requireAdmin, async (req, res) => {
  const data = parse(
    z.object({ label: z.string().trim().min(1).max(100), color, category: z.enum(PROJECT_CATEGORIES) }),
    req.body,
  );
  const stage = await transaction(async () => {
    await query('LOCK TABLE project_stages IN EXCLUSIVE MODE');
    const n = await one<{ n: number }>('SELECT count(*)::int n FROM project_stages');
    if ((n?.n ?? 0) >= 50) throw badRequest('Use 50 stages or fewer.');
    if (await one('SELECT 1 FROM project_stages WHERE lower(label)=lower($1)', [data.label]))
      throw conflict('A stage with this label already exists.');
    return one(
      `INSERT INTO project_stages(id,label,color,category,position)
       VALUES($1,$2,$3,$4,(SELECT COALESCE(max(position)+1,0) FROM project_stages)) RETURNING *`,
      [`stage_${randomUUID().replace(/-/g, '')}`, data.label, data.color, data.category],
    );
  });
  await audit(currentUser(req), 'project_stage', null, 'created', `Project stage ${data.label} created`);
  res.status(201).json(stage);
});

router.put('/project-stages/order', requireAdmin, async (req, res) => {
  const { stageIds } = parse(z.object({ stageIds: z.array(z.string()).min(1).max(50) }), req.body);
  await transaction(async () => {
    const ids = (await many('SELECT id FROM project_stages')).map((r) => r.id);
    if (ids.length !== stageIds.length || new Set(stageIds).size !== ids.length || !ids.every((id) => stageIds.includes(id)))
      throw badRequest('Include every stage exactly once when reordering.');
    for (const [i, id] of stageIds.entries()) await query('UPDATE project_stages SET position=$2 WHERE id=$1', [id, i]);
  });
  res.json(await list());
});

router.patch('/project-stages/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const data = parse(
    z.object({
      label: z.string().trim().min(1).max(100).optional(),
      color: color.optional(),
      category: z.enum(PROJECT_CATEGORIES).optional(),
    }),
    req.body,
  );
  if (!Object.keys(data).length) throw badRequest('Provide a stage change.');
  const stage = await one('SELECT * FROM project_stages WHERE id=$1', [id]);
  if (!stage) throw notFound('Stage');
  if (data.label && (await one('SELECT 1 FROM project_stages WHERE lower(label)=lower($1) AND id<>$2', [data.label, id])))
    throw conflict('A stage with this label already exists.');
  if (data.category && data.category !== stage.category) {
    if (stage.system) throw conflict('System stage categories cannot change.');
    if (['completed', 'archived'].includes(data.category) && (await one('SELECT 1 FROM lead_stages WHERE project_stage_id=$1', [id])))
      throw conflict('This stage receives closed-won leads, so it cannot be completed or archived.');
    if (await one('SELECT 1 FROM projects WHERE stage=$1', [id]))
      throw conflict('Move projects out of this stage before changing its category.');
  }
  const updated = await one(
    `UPDATE project_stages SET label=COALESCE($2,label), color=COALESCE($3,color), category=COALESCE($4,category), updated_at=now()
      WHERE id=$1 RETURNING *`,
    [id, data.label ?? null, data.color ?? null, data.category ?? null],
  );
  res.json(updated);
});

router.delete('/project-stages/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  await transaction(async () => {
    const stage = await one('SELECT * FROM project_stages WHERE id=$1', [id]);
    if (!stage) throw notFound('Stage');
    if (stage.system) throw conflict('System stages cannot be deleted.');
    if (await one('SELECT 1 FROM lead_stages WHERE project_stage_id=$1', [id]))
      throw conflict('Closed-won leads hand off to this stage. Change that first.');
    if (await one('SELECT 1 FROM projects WHERE stage=$1', [id])) throw conflict('Move projects out of this stage first.');
    await query('DELETE FROM project_stages WHERE id=$1', [id]);
    await query('UPDATE project_stages SET position=position-1 WHERE position>$1', [stage.position]);
  });
  res.json({ ok: true });
});
