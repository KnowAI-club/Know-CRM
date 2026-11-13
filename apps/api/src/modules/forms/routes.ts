import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, notFound, HttpError } from '../../lib/errors.js';
import { leadHistory, projectActivity } from '../../lib/activity.js';
import { notify } from '../../lib/notify.js';
import { workspaceCurrency } from '../../lib/settings.js';
import { rateLimit } from '../../middleware/security.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { ensureContact } from '../contacts/service.js';

const uuid = z.string().uuid();
const RESERVED = new Set(['name', 'email', '__proto__', 'constructor', 'prototype']);

const field = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Invalid field id').refine((id) => !RESERVED.has(id), 'Reserved field id'),
    label: z.string().trim().min(1, 'Every question needs a label.').max(200),
    type: z.enum(['text', 'email', 'phone', 'textarea', 'select', 'checkbox', 'date']),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === 'select') {
      const opts = f.options ?? [];
      if (opts.length < 2 || new Set(opts).size !== opts.length)
        ctx.addIssue({ code: 'custom', path: ['options'], message: `${f.label}: add 2–30 different options.` });
    }
  })
  .transform((f) => (f.type === 'select' ? f : { ...f, options: undefined }));
const fields = z
  .array(field)
  .max(40, 'Use 40 questions or fewer.')
  .refine((list) => new Set(list.map((f) => f.id)).size === list.length, 'Question ids must be unique.');
type Field = z.infer<typeof field>;

const formView = ({ published_revision, published, ...f }: Record<string, any>) => ({
  ...f,
  has_unpublished_changes: f.revision !== published_revision,
  submission_count: f.submission_count ?? 0,
});

// ── Staff ────────────────────────────────────────────────────────────────────
export const router = Router();
router.use('/lead-forms', requireStaff);

const FORM_SELECT = `SELECT f.*, (SELECT count(*)::int FROM lead_submissions s WHERE s.form_id=f.id) AS submission_count FROM lead_forms f`;

router.get('/lead-forms', async (_req, res) => {
  res.json((await many(`${FORM_SELECT} ORDER BY f.updated_at DESC`)).map(formView));
});

router.get('/lead-forms/:id', async (req, res) => {
  const f = await one(`${FORM_SELECT} WHERE f.id=$1`, [parse(uuid, req.params.id)]);
  if (!f) throw notFound('Form');
  res.json(formView(f));
});

const formSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  description: z.string().trim().max(5000).default(''),
  fields: fields.default([]),
});

router.post('/lead-forms', async (req, res) => {
  const me = currentUser(req);
  const d = parse(formSchema, req.body);
  const f = await one(
    `INSERT INTO lead_forms(title, description, fields, token, owner_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [d.title, d.description, JSON.stringify(d.fields), randomBytes(24).toString('base64url'), me.id],
  );
  res.status(201).json(formView(f!));
});

router.patch('/lead-forms/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(formSchema.partial().extend({ archived: z.boolean().optional() }), req.body);
  const row = await transaction(async () => {
    const f = await one('SELECT * FROM lead_forms WHERE id=$1 FOR UPDATE', [id]);
    if (!f) throw notFound('Form');
    const next = { title: d.title ?? f.title, description: d.description ?? f.description, fields: d.fields ?? f.fields };
    const changed = JSON.stringify(next) !== JSON.stringify({ title: f.title, description: f.description, fields: f.fields });
    return one(
      `UPDATE lead_forms SET title=$2, description=$3, fields=$4, archived=$5, revision=revision+$6, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, next.title, next.description, JSON.stringify(next.fields), d.archived ?? f.archived, changed ? 1 : 0],
    );
  });
  res.json(formView(row!));
});

router.post('/lead-forms/:id/publish', async (req, res) => {
  const me = currentUser(req);
  const id = parse(uuid, req.params.id);
  const row = await transaction(async () => {
    const f = await one('SELECT * FROM lead_forms WHERE id=$1 FOR UPDATE', [id]);
    if (!f) throw notFound('Form');
    if (f.archived) throw conflict('Restore this form before publishing.');
    parse(fields, f.fields);
    if (f.published_revision === f.revision) return f;
    const version = (f.published_version ?? 0) + 1;
    const snapshot = { title: f.title, description: f.description, fields: f.fields, version, published_at: new Date(), published_by: me.id };
    return one(
      `UPDATE lead_forms SET published_version=$2, published_revision=revision, published=$3, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, version, JSON.stringify(snapshot)],
    );
  });
  res.json(formView(row!));
});

router.get('/lead-forms/:id/submissions', async (req, res) => {
  res.json(
    await many(
      `SELECT s.id, s.name, s.email, s.answers, s.version, s.lead_id, s.contact_id, s.created_at, f.published->'fields' AS fields
         FROM lead_submissions s JOIN lead_forms f ON f.id=s.form_id WHERE s.form_id=$1 ORDER BY s.created_at DESC`,
      [parse(uuid, req.params.id)],
    ),
  );
});

// ── Public ───────────────────────────────────────────────────────────────────
export const publicRouter = Router();

async function liveForm(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw notFound('Form');
  const f = await one('SELECT * FROM lead_forms WHERE token=$1', [token]);
  if (!f) throw notFound('Form');
  if (f.archived || !f.published_version) throw new HttpError(404, 'This form is not available.', 'not_found');
  return f;
}

publicRouter.get('/public/forms/:token', rateLimit('public-form-read', 120, 10 * 60_000), async (req, res) => {
  const f = await liveForm(String(req.params.token));
  const ws = await one('SELECT name FROM workspace_settings WHERE id=1');
  const p = f.published;
  res.json({ title: p.title, description: p.description, fields: p.fields, version: p.version, workspace: ws?.name ?? '' });
});

const submissionSchema = z
  .object({
    submissionId: uuid,
    name: z.string().trim().min(1, 'Enter your name.').max(200),
    email: zs.email,
    answers: z.record(z.string(), z.union([z.string().max(20000), z.boolean()])).default({}),
    website: z.string().max(500).default(''),
    version: z.number().int().positive().optional(),
  })
  .strict();

function cleanAnswers(fieldsList: Field[], answers: Record<string, string | boolean>) {
  for (const key of Object.keys(answers))
    if (!fieldsList.some((f) => f.id === key)) throw badRequest('The submission contains an unknown field.');
  const out: Record<string, string | boolean> = {};
  for (const f of fieldsList) {
    const raw = answers[f.id];
    if (f.type === 'checkbox') {
      if (raw !== undefined && typeof raw !== 'boolean') throw badRequest(`${f.label}: tick or untick the box.`);
      if (f.required && raw !== true) throw badRequest(`${f.label} is required.`);
      out[f.id] = raw === true;
      continue;
    }
    if (raw !== undefined && typeof raw !== 'string') throw badRequest(`${f.label}: enter text.`);
    const value = (raw ?? '').trim();
    if (!value) {
      if (f.required) throw badRequest(`${f.label} is required.`);
      out[f.id] = '';
      continue;
    }
    if (value.length > (f.type === 'textarea' ? 20000 : 2000)) throw badRequest(`${f.label}: the answer is too long.`);
    if (f.type === 'email' && !z.string().email().safeParse(value).success) throw badRequest(`${f.label}: enter a valid email.`);
    if (f.type === 'phone' && !/^[+()\d\s.-]{3,40}$/.test(value)) throw badRequest(`${f.label}: enter a valid phone number.`);
    if (f.type === 'select' && !f.options?.includes(value)) throw badRequest(`${f.label}: choose one of the options.`);
    if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))))
      throw badRequest(`${f.label}: enter a valid date.`);
    out[f.id] = value;
  }
  return out;
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;

publicRouter.post(
  '/public/forms/:token/submissions',
  rateLimit('public-form-submit', 20, 60 * 60_000),
  async (req, res) => {
    const token = String(req.params.token);
    const body = parse(submissionSchema, req.body);
    if (body.website) return void res.status(202).json({ received: true, submissionId: body.submissionId });
    const hash = createHash('sha256')
      .update(JSON.stringify(canonical({ name: body.name, email: body.email, answers: body.answers, version: body.version ?? null })))
      .digest('hex');
    const result = await transaction(async () => {
      const f = await liveForm(token);
      const existing = await one('SELECT request_hash, form_id FROM lead_submissions WHERE id=$1', [body.submissionId]);
      if (existing) {
        if (existing.request_hash !== hash || existing.form_id !== f.id) throw conflict('This submission ID has already been used.');
        return { created: false };
      }
      if (body.version && body.version !== f.published_version) throw conflict('This form changed. Refresh it before submitting.');
      const answers = cleanAnswers(f.published.fields, body.answers);
      const contact = await ensureContact({ name: body.name, email: body.email }, 'Website');

      // Inquiry lands in the sales pipeline as a lead (unless one is already open) with an intake project.
      let leadId: string | null = (await one(`SELECT id FROM leads WHERE lower(email)=$1 AND state IN ('active','nurture')`, [body.email]))?.id ?? null;
      if (!leadId && !(await one(`SELECT 1 FROM leads WHERE lower(email)=$1 AND state='won'`, [body.email]))) {
        const stage = await one(`SELECT id FROM lead_stages WHERE kind='open' ORDER BY position LIMIT 1`);
        const notes = f.published.fields
          .map((fl: Field) => `${fl.label}: ${typeof answers[fl.id] === 'boolean' ? (answers[fl.id] ? 'Yes' : 'No') : answers[fl.id] || '—'}`)
          .join('\n');
        const lead = await one(
          `INSERT INTO leads(name, email, stage, data, contact_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [body.name, body.email, stage!.id, JSON.stringify({ source: 'Lead form', ownerId: f.owner_id, notes: notes.slice(0, 10000) }), contact.id],
        );
        leadId = lead!.id;
        await leadHistory(leadId!, null, 'Lead created', { reason: `Lead form: ${f.title}` });
      }
      let project = await one(
        `SELECT p.id FROM projects p JOIN project_stages s ON s.id=p.stage
          WHERE p.contact_id=$1 AND s.category NOT IN ('completed','archived') ORDER BY (p.phase='intake') DESC, p.created_at LIMIT 1`,
        [contact.id],
      );
      if (!project)
        project = await one(
          `INSERT INTO projects(name, contact_id, stage, phase, value, currency, description, lead_source, owner_id)
           VALUES($1,$2,'inquiry','intake',0,$3,$4,'Lead form',$5) RETURNING id`,
          [`${f.title} · ${body.name}`.slice(0, 500), contact.id, await workspaceCurrency(), `Received through lead form: ${f.title}`, f.owner_id],
        );
      await projectActivity({ name: body.name }, project!.id, 'Lead form submitted');
      await query(
        `INSERT INTO lead_submissions(id, form_id, version, name, email, answers, request_hash, contact_id, lead_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [body.submissionId, f.id, f.published_version, body.name, body.email, JSON.stringify(answers), hash, contact.id, leadId],
      );
      await notify({ userId: f.owner_id, kind: 'lead_form', title: `New inquiry from ${body.name}`, body: f.title, link: leadId ? `/leads/${leadId}` : '/leads' });
      return { created: true };
    });
    res.status(result.created ? 201 : 200).json({ received: true, submissionId: body.submissionId });
  },
);
