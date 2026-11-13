import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { notFound } from '../../lib/errors.js';
import { requireStaff } from '../../middleware/auth.js';

/** Email library: copy the team sends by hand. Nothing here sends email. */
export const router = Router();
router.use('/email-templates', requireStaff);

router.get('/email-templates', async (_req, res) => {
  res.json(await many('SELECT * FROM email_templates ORDER BY grp, id'));
});

router.post('/email-templates', async (req, res) => {
  const d = parse(
    z.object({
      group: z.enum(['EM', 'NU']),
      title: z.string().trim().min(1, 'Enter a template name.').max(200),
      subject: z.string().trim().max(300).default(''),
      body: z.string().max(50000).default(''),
    }),
    req.body,
  );
  const row = await transaction(async () => {
    await query('LOCK TABLE email_templates IN EXCLUSIVE MODE');
    const max = await one<{ n: number }>(`SELECT COALESCE(max(substring(id from 4)::int), 0) AS n FROM email_templates WHERE id LIKE $1`, [
      `${d.group}-%`,
    ]);
    const id = `${d.group}-${String((max?.n ?? 0) + 1).padStart(2, '0')}`;
    return one('INSERT INTO email_templates(id, grp, title, subject, body) VALUES($1,$2,$3,$4,$5) RETURNING *', [
      id,
      d.group,
      d.title,
      d.subject,
      d.body,
    ]);
  });
  res.status(201).json(row);
});

router.patch('/email-templates/:id', async (req, res) => {
  const d = parse(
    z.object({
      title: z.string().trim().min(1).max(200).optional(),
      subject: z.string().trim().max(300).optional(),
      body: z.string().max(50000).optional(),
    }),
    req.body,
  );
  const row = await one(
    `UPDATE email_templates SET title=COALESCE($2,title), subject=COALESCE($3,subject), body=COALESCE($4,body), updated_at=now()
     WHERE id=$1 RETURNING *`,
    [String(req.params.id), d.title ?? null, d.subject ?? null, d.body ?? null],
  );
  if (!row) throw notFound('Template');
  res.json(row);
});

router.delete('/email-templates/:id', async (req, res) => {
  const row = await one('DELETE FROM email_templates WHERE id=$1 RETURNING id', [String(req.params.id)]);
  if (!row) throw notFound('Template');
  res.status(204).end();
});
