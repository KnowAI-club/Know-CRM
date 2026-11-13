import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { conflict, forbidden, notFound, badRequest } from '../../lib/errors.js';
import { notifyMentions } from '../../lib/notify.js';
import { audit } from '../../lib/audit.js';
import { currentUser, requireStaff } from '../../middleware/auth.js';
import { COLUMNS, contactSchema, insertContact, normalizeTax, withOrigin, ORIGINS, type ContactInput } from './service.js';

export const router = Router();
router.use('/contacts', requireStaff);

const idParam = z.object({ id: z.string().uuid() });

router.get('/contacts', async (_req, res) => {
  res.json(
    await many(`
      SELECT c.*,
        (SELECT count(*)::int FROM contact_comments cc WHERE cc.contact_id=c.id) AS comment_count,
        GREATEST(
          (SELECT max(created_at) FROM contact_comments cc WHERE cc.contact_id=c.id),
          (SELECT max(a.created_at) FROM activities a JOIN projects p ON p.id=a.project_id WHERE p.contact_id=c.id),
          (SELECT max(m.created_at) FROM messages m JOIN projects p ON p.id=m.project_id WHERE p.contact_id=c.id)
        ) AS last_interaction_at,
        CASE
          WHEN EXISTS (SELECT 1 FROM leads l LEFT JOIN projects p ON p.id=l.project_id
                        WHERE l.state='won' AND (p.contact_id=c.id OR (c.email<>'' AND lower(l.email)=lower(c.email)))) THEN 'won'
          WHEN c.email<>'' AND EXISTS (SELECT 1 FROM leads l WHERE l.state IN ('active','nurture') AND lower(l.email)=lower(c.email)) THEN 'open'
          WHEN c.email<>'' AND EXISTS (SELECT 1 FROM leads l WHERE l.state='dropped' AND lower(l.email)=lower(c.email)) THEN 'dropped'
        END AS lead_status,
        (SELECT l.id FROM leads l WHERE c.email<>'' AND l.state IN ('active','nurture') AND lower(l.email)=lower(c.email)
          ORDER BY l.created_at DESC LIMIT 1) AS lead_id,
        COALESCE((SELECT json_agg(json_build_object('id',p.id,'name',p.name,'archived',s.category='archived') ORDER BY p.created_at)
           FROM projects p JOIN project_stages s ON s.id=p.stage WHERE p.contact_id=c.id AND p.phase='delivery'), '[]') AS projects
      FROM contacts c ORDER BY lower(c.name)`),
  );
});

router.get('/contacts/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const contact = await one('SELECT * FROM contacts WHERE id=$1', [id]);
  if (!contact) throw notFound('Contact');
  res.json(contact);
});

router.post('/contacts', async (req, res) => {
  const data = normalizeTax(parse(contactSchema, req.body));
  data.tags = withOrigin(data.tags, 'Manual');
  const contact = await insertContact(data);
  await audit(currentUser(req), 'contact', contact.id, 'created', `Contact ${contact.name} created`);
  res.status(201).json(contact);
});

router.post('/contacts/import', async (req, res) => {
  const { rows } = parse(z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000) }), req.body);
  const parsed: ContactInput[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const r = contactSchema.safeParse(row);
    if (!r.success) {
      errors.push({ row: i + 1, message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      return;
    }
    try {
      parsed.push(normalizeTax(r.data));
    } catch (e) {
      errors.push({ row: i + 1, message: (e as Error).message });
    }
  });
  if (errors.length) throw badRequest('Fix the highlighted rows and try again.', { rows: errors });
  const result = await transaction(async () => {
    const existing = new Set((await many<{ e: string }>(`SELECT lower(email) e FROM contacts WHERE email<>''`)).map((r) => r.e));
    let created = 0;
    let skipped = 0;
    for (const c of parsed) {
      const key = c.email.toLowerCase();
      if (key && existing.has(key)) {
        skipped++;
        continue;
      }
      if (key) existing.add(key);
      c.tags = withOrigin(c.tags, 'Manual');
      await insertContact(c);
      created++;
    }
    return { created, skipped };
  });
  await audit(currentUser(req), 'contact', null, 'imported', `Imported ${result.created} contacts`);
  res.status(201).json(result);
});

router.patch('/contacts/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(contactSchema.partial(), req.body) as Partial<ContactInput>;
  // Strip defaults zod filled for keys the client did not send.
  for (const k of Object.keys(data)) if (!(k in req.body)) delete (data as any)[k];
  const current = await one('SELECT * FROM contacts WHERE id=$1', [id]);
  if (!current) throw notFound('Contact');
  if (me.role !== 'admin') {
    if (data.email !== undefined && data.email !== current.email) throw forbidden("Only an admin can change a client's email or phone.");
    if (data.phone !== undefined && data.phone !== current.phone) throw forbidden("Only an admin can change a client's email or phone.");
  }
  const merged = normalizeTax({ gstin: data.gstin ?? current.gstin, pan: data.pan ?? current.pan });
  if (data.gstin !== undefined || data.pan !== undefined) {
    data.gstin = merged.gstin;
    data.pan = merged.pan;
  }
  if (data.tags) {
    const previous = (current.tags as string[]).find((t) => ORIGINS.some((o) => o.toLowerCase() === t.toLowerCase()));
    if (previous) data.tags = withOrigin(data.tags, previous as 'Website' | 'Manual');
  }
  const keys = Object.keys(data) as (keyof ContactInput)[];
  if (!keys.length) return res.json(current);
  const updated = await one(
    `UPDATE contacts SET ${keys.map((k, i) => `${COLUMNS[k]}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, ...keys.map((k) => data[k])],
  );
  await audit(me, 'contact', id, 'updated', `Contact ${updated!.name} updated`);
  res.json(updated);
});

router.delete('/contacts/:id', async (req, res) => {
  const me = currentUser(req);
  if (me.role !== 'admin') throw forbidden('Only an admin can delete a contact.');
  const { id } = parse(idParam, req.params);
  const contact = await one('SELECT name FROM contacts WHERE id=$1', [id]);
  if (!contact) throw notFound('Contact');
  if (await one('SELECT 1 FROM projects WHERE contact_id=$1', [id]))
    throw conflict('This contact has projects. Archive or move those projects first.');
  if (await one('SELECT 1 FROM leads WHERE contact_id=$1', [id]))
    throw conflict('This contact is linked to a lead, so it cannot be deleted.');
  await query('DELETE FROM contacts WHERE id=$1', [id]);
  await audit(me, 'contact', id, 'deleted', `Contact ${contact.name} deleted`);
  res.json({ ok: true });
});

router.get('/contacts/:id/comments', async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(
    await many('SELECT id, body, author_name, author_id, created_at FROM contact_comments WHERE contact_id=$1 ORDER BY created_at DESC', [
      id,
    ]),
  );
});

router.post('/contacts/:id/comments', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(5000) }), req.body);
  const contact = await one('SELECT name FROM contacts WHERE id=$1', [id]);
  if (!contact) throw notFound('Contact');
  const comment = await one('INSERT INTO contact_comments(contact_id, body, author_id, author_name) VALUES($1,$2,$3,$4) RETURNING *', [
    id,
    body,
    me.id,
    me.name,
  ]);
  await notifyMentions({ author: me, after: body, where: `a comment on ${contact.name}`, link: `/clients/${id}` });
  res.status(201).json(comment);
});
