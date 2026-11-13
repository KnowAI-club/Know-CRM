import { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { CURRENCIES } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { projectActivity } from '../../lib/activity.js';
import { currentUser, requireRole, requireStaff } from '../../middleware/auth.js';
import { projectFor } from '../projects/access.js';

export const router = Router();
const uuid = z.string().uuid();
const KINDS = ['proposal', 'contract', 'questionnaire'] as const;
export const CONSENT_TEXT = 'I have reviewed this document and agree to sign it electronically using my typed name.';

// ── Blocks ───────────────────────────────────────────────────────────────────
const blockId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const block = z.discriminatedUnion('type', [
  z.object({ id: blockId, type: z.literal('heading'), text: z.string().trim().min(1, 'Headings need text.').max(200), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }),
  z.object({ id: blockId, type: z.literal('text'), text: z.string().max(20000).default('') }),
  z.object({
    id: blockId,
    type: z.literal('service'),
    name: z.string().trim().min(1, 'Name the service.').max(200),
    description: z.string().max(5000).default(''),
    quantity: z.coerce.number().positive().max(100000),
    unitPrice: z.coerce.number().int().min(0).max(1e11),
    currency: z.enum(CURRENCIES),
  }).refine((b) => Math.round(b.quantity * b.unitPrice) <= 1e11, 'Service total is too large.'),
  z.object({
    id: blockId,
    type: z.literal('question'),
    label: z.string().trim().min(1, 'Questions need a label.').max(200),
    questionType: z.enum(['short', 'long', 'choice']).default('short'),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  }).refine((b) => b.questionType !== 'choice' || new Set(b.options).size >= 2, 'A choice question needs at least two different options.'),
  z.object({ id: blockId, type: z.literal('signature'), label: z.string().trim().min(1).max(200) }),
]);
const blocks = z
  .array(block)
  .min(1, 'Add at least one block.')
  .max(100, 'Use 100 blocks or fewer.')
  .refine((list) => new Set(list.map((b) => b.id)).size === list.length, 'Block ids must be unique.');
type Block = z.infer<typeof block>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}
const contentHash = (d: { title: string; kind: string; blocks: unknown }) =>
  createHash('sha256').update(JSON.stringify(canonical({ title: d.title, kind: d.kind, blocks: d.blocks, version: 1 }))).digest('hex');

// ── Templates ────────────────────────────────────────────────────────────────
const templateSchema = z.object({ name: z.string().trim().min(1, 'Name the template.').max(200), kind: z.enum(KINDS), blocks });

router.get('/document-templates', requireStaff, async (_req, res) => {
  res.json(await many('SELECT * FROM document_templates ORDER BY updated_at DESC, id'));
});

router.post('/document-templates', requireStaff, async (req, res) => {
  const d = parse(templateSchema, req.body);
  res.status(201).json(
    await one('INSERT INTO document_templates(name, kind, blocks) VALUES($1,$2,$3) RETURNING *', [d.name, d.kind, JSON.stringify(d.blocks)]),
  );
});

router.patch('/document-templates/:id', requireStaff, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const current = await one('SELECT * FROM document_templates WHERE id=$1', [id]);
  if (!current) throw notFound('Template');
  const d = parse(templateSchema, { name: current.name, kind: current.kind, blocks: current.blocks, ...req.body });
  res.json(
    await one(
      'UPDATE document_templates SET name=$2, kind=$3, blocks=$4, version=version+1, updated_at=now() WHERE id=$1 RETURNING *',
      [id, d.name, d.kind, JSON.stringify(d.blocks)],
    ),
  );
});

router.delete('/document-templates/:id', requireStaff, async (req, res) => {
  const id = parse(uuid, req.params.id);
  await transaction(async () => {
    if (await one(`SELECT 1 FROM documents WHERE template_id=$1 AND status<>'draft' LIMIT 1`, [id]))
      throw conflict('A published document was made from this template, so it cannot be deleted.');
    await query(`UPDATE documents SET template_id=NULL WHERE template_id=$1 AND status='draft'`, [id]);
    const row = await one('DELETE FROM document_templates WHERE id=$1 RETURNING id', [id]);
    if (!row) throw notFound('Template');
  });
  res.status(204).end();
});

// ── Project documents ────────────────────────────────────────────────────────
const LIST_COLUMNS = 'id, project_id, template_id, title, kind, status, content_hash, published_at, created_at, updated_at';

router.get('/projects/:id/documents', async (req, res) => {
  const me = currentUser(req);
  const id = parse(uuid, req.params.id);
  await projectFor(req, id);
  res.json(
    await many(
      `SELECT ${LIST_COLUMNS} FROM documents WHERE project_id=$1 ${me.role === 'client' ? `AND status='published'` : ''} ORDER BY updated_at DESC`,
      [id],
    ),
  );
});

router.post('/projects/:id/documents', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const projectId = parse(uuid, req.params.id);
  await projectFor(req, projectId, true);
  const body = parse(
    z.object({ templateId: uuid.nullish(), title: z.string().trim().max(200).optional(), kind: z.enum(KINDS).optional(), blocks: z.unknown().optional() }),
    req.body,
  );
  const template = body.templateId ? await one('SELECT * FROM document_templates WHERE id=$1', [body.templateId]) : null;
  if (body.templateId && !template) throw badRequest('Choose an existing template.');
  const title = parse(z.string().trim().min(1, 'Add a title.').max(200), body.title || template?.name || '');
  const kind = parse(z.enum(KINDS, 'Choose a document type.'), body.kind ?? template?.kind);
  const content = parse(blocks, body.blocks ?? template?.blocks);
  const doc = await one(
    `INSERT INTO documents(project_id, template_id, title, kind, blocks, created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, template?.id ?? null, title, kind, JSON.stringify(content), me.id],
  );
  await projectActivity(me, projectId, `Document draft created: ${title}`);
  res.status(201).json(doc);
});

async function loadDoc(req: Parameters<typeof currentUser>[0], id: string) {
  const me = currentUser(req);
  const doc = await one('SELECT * FROM documents WHERE id=$1', [id]);
  if (!doc) throw notFound('Document');
  await projectFor(req, doc.project_id);
  if (me.role === 'client' && doc.status !== 'published') throw notFound('Document');
  return doc;
}

router.get('/documents/:id', async (req, res) => {
  const me = currentUser(req);
  const doc = await loadDoc(req, parse(uuid, req.params.id));
  const actions = await many(
    `SELECT id, user_id, actor_name, action, block_id, typed_name, answers, created_at FROM document_actions
      WHERE document_id=$1 ORDER BY created_at`,
    [doc.id],
  );
  const visible = me.role === 'client' ? actions.filter((a) => a.action !== 'answered' || a.user_id === me.id) : actions;
  const { created_by, ...rest } = doc;
  res.json({ ...(me.role === 'client' ? rest : doc), actions: visible, consentText: CONSENT_TEXT });
});

router.patch('/documents/:id', requireStaff, async (req, res) => {
  const doc = await loadDoc(req, parse(uuid, req.params.id));
  if (doc.status !== 'draft') throw conflict('Published documents cannot be edited. Create a new draft instead.');
  const body = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), blocks: blocks.optional() }), req.body);
  const row = await one('UPDATE documents SET title=$2, blocks=$3, updated_at=now() WHERE id=$1 RETURNING *', [
    doc.id,
    body.title ?? doc.title,
    JSON.stringify(body.blocks ?? doc.blocks),
  ]);
  res.json(row);
});

router.delete('/documents/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const doc = await loadDoc(req, parse(uuid, req.params.id));
  if (doc.status !== 'draft') throw conflict('Published documents are kept as a record and cannot be deleted.');
  await query('DELETE FROM documents WHERE id=$1', [doc.id]);
  await projectActivity(me, doc.project_id, `Document draft deleted: ${doc.title}`);
  res.status(204).end();
});

router.post('/documents/:id/publish', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const doc = await loadDoc(req, parse(uuid, req.params.id));
  if (doc.status !== 'draft') throw conflict('This document is already published.');
  const list = doc.blocks as Block[];
  if (doc.kind === 'contract' && !list.some((b) => b.type === 'signature'))
    throw badRequest('A contract needs at least one signature block before publishing.');
  const row = await one(
    `UPDATE documents SET status='published', content_hash=$2, published_at=now(), updated_at=now() WHERE id=$1 RETURNING *`,
    [doc.id, contentHash(doc as never)],
  );
  await projectActivity(me, doc.project_id, `Document published to client portal: ${doc.title}`, 'client');
  res.json(row);
});

// ── Client evidence ──────────────────────────────────────────────────────────
const evidence = { version: z.literal(1).default(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/) };

async function clientDoc(req: Parameters<typeof currentUser>[0]) {
  const doc = await loadDoc(req, parse(uuid, req.params.id));
  if (doc.status !== 'published') throw notFound('Document');
  return doc;
}
const assertHash = (doc: Record<string, any>, hash: string) => {
  if (doc.content_hash !== hash) throw conflict('This document version has changed. Reload it before continuing.');
};

router.post('/documents/:id/responses', requireRole('client'), async (req, res) => {
  const me = currentUser(req);
  const doc = await clientDoc(req);
  const body = parse(z.object({ ...evidence, answers: z.record(z.string(), z.string().max(20000)) }), req.body);
  assertHash(doc, body.contentHash);
  const questions = (doc.blocks as Block[]).filter((b): b is Extract<Block, { type: 'question' }> => b.type === 'question');
  if (!questions.length) throw badRequest('This document has no questions.');
  for (const key of Object.keys(body.answers))
    if (!questions.some((q) => q.id === key)) throw badRequest('The answers include an unknown question.');
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const value = (body.answers[q.id] ?? '').trim();
    if (q.required && !value) throw badRequest(`${q.label} is required.`);
    if (value && q.questionType === 'choice' && !q.options.includes(value)) throw badRequest(`${q.label}: choose one of the options.`);
    if (q.questionType === 'short' && value.length > 500) throw badRequest(`${q.label}: keep it under 500 characters.`);
    answers[q.id] = value;
  }
  const row = await one(
    `INSERT INTO document_actions(document_id, user_id, actor_name, action, answers, content_hash) VALUES($1,$2,$3,'answered',$4,$5) RETURNING *`,
    [doc.id, me.id, me.name, JSON.stringify(answers), doc.content_hash],
  );
  await projectActivity(me, doc.project_id, `Client submitted document answers: ${doc.title}`);
  res.status(201).json(row);
});

router.post('/documents/:id/decision', requireRole('client'), async (req, res) => {
  const me = currentUser(req);
  const doc = await clientDoc(req);
  const body = parse(z.object({ ...evidence, decision: z.enum(['accepted', 'declined']) }), req.body);
  assertHash(doc, body.contentHash);
  if (doc.kind !== 'proposal') throw badRequest('Only proposals can be accepted or declined.');
  const existing = await one(`SELECT * FROM document_actions WHERE document_id=$1 AND user_id=$2 AND action IN ('accepted','declined')`, [doc.id, me.id]);
  if (existing) {
    if (existing.action !== body.decision) throw conflict('Your recorded decision is immutable. Ask the team for a revised proposal.');
    return void res.status(200).json(existing);
  }
  const row = await one(
    `INSERT INTO document_actions(document_id, user_id, actor_name, action, content_hash) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [doc.id, me.id, me.name, body.decision, doc.content_hash],
  );
  await projectActivity(me, doc.project_id, `Client ${body.decision} proposal: ${doc.title}`, 'client');
  res.status(201).json(row);
});

router.post('/documents/:id/sign', requireRole('client'), async (req, res) => {
  const me = currentUser(req);
  const doc = await clientDoc(req);
  const body = parse(
    z.object({ ...evidence, blockId, typedName: z.string().trim().min(2, 'Type your full name.').max(200), consent: z.literal(true, 'Confirm you agree to sign electronically.') }),
    req.body,
  );
  assertHash(doc, body.contentHash);
  if (doc.kind !== 'contract' || !(doc.blocks as Block[]).some((b) => b.type === 'signature' && b.id === body.blockId))
    throw badRequest('Choose a signature block on this contract.');
  const existing = await one(`SELECT * FROM document_actions WHERE document_id=$1 AND user_id=$2 AND block_id=$3 AND action='signed'`, [doc.id, me.id, body.blockId]);
  if (existing) {
    if (existing.typed_name !== body.typedName) throw conflict('This signature is immutable. Ask the team for a revised contract.');
    return void res.status(200).json(existing);
  }
  const row = await one(
    `INSERT INTO document_actions(document_id, user_id, actor_name, action, block_id, typed_name, content_hash) VALUES($1,$2,$3,'signed',$4,$5,$6) RETURNING *`,
    [doc.id, me.id, me.name, body.blockId, body.typedName, doc.content_hash],
  );
  await projectActivity(me, doc.project_id, `Client signed contract: ${doc.title}`, 'client');
  res.status(201).json(row);
});

