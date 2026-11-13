import { Router } from 'express';
import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '@know-crm/shared';
import { many, one, query } from '../../db/pool.js';
import { parse } from '../../lib/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { workspaceCurrency } from '../../lib/settings.js';
import { sendCsv, isoDay, minorToDecimal } from '../../lib/csv.js';
import { currentUser, requireAdmin, requireStaff } from '../../middleware/auth.js';

/** Expenses and the service catalog (a reference price list). */
export const router = Router();
router.use(['/expenses', '/services'], requireStaff);
const uuid = z.string().uuid();

const EXPENSE_SELECT = `SELECT e.*, p.name AS project_name, u.name AS created_by_name FROM expenses e
  LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN users u ON u.id=e.created_by`;

const expenseSchema = z.object({
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  vendor: z.string().trim().min(1, 'Add the vendor.').max(200),
  description: z.string().trim().max(2000).default(''),
  category: z.enum(Object.keys(EXPENSE_CATEGORIES) as [string, ...string[]], "Choose a category."),
  amount: z.coerce.number().int().min(1, 'Enter an amount.').max(1e11),
  projectId: z.union([uuid, z.literal(''), z.null()]).default(null).transform((v) => v || null),
});

async function checkProject(id: string | null) {
  if (id && !(await one('SELECT 1 FROM projects WHERE id=$1', [id]))) throw badRequest('Choose an existing project.');
}

router.get('/expenses', async (_req, res) => {
  res.json(await many(`${EXPENSE_SELECT} ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 5000`));
});

router.get('/expenses/export.csv', async (_req, res) => {
  const rows = await many(`${EXPENSE_SELECT} ORDER BY e.spent_on DESC`);
  sendCsv(
    res,
    `expenses-${isoDay()}.csv`,
    ['Date', 'Vendor', 'Category', 'Description', 'Project', 'Amount', 'Currency'],
    rows.map((e) => [e.spent_on, e.vendor, e.category, e.description, e.project_name ?? '', minorToDecimal(e.amount), e.currency]),
  );
});

router.post('/expenses', async (req, res) => {
  const me = currentUser(req);
  const d = parse(expenseSchema, req.body);
  await checkProject(d.projectId);
  const row = await one(
    `INSERT INTO expenses(spent_on, vendor, description, category, amount, currency, project_id, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [d.spentOn, d.vendor, d.description, d.category, d.amount, await workspaceCurrency(), d.projectId, me.id],
  );
  res.status(201).json(await one(`${EXPENSE_SELECT} WHERE e.id=$1`, [row!.id]));
});

router.patch('/expenses/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const current = await one('SELECT * FROM expenses WHERE id=$1', [id]);
  if (!current) throw notFound('Expense');
  const d = parse(expenseSchema, {
    spentOn: current.spent_on, vendor: current.vendor, description: current.description, category: current.category,
    amount: current.amount, projectId: current.project_id, ...req.body,
  });
  await checkProject(d.projectId);
  await query(
    `UPDATE expenses SET spent_on=$2, vendor=$3, description=$4, category=$5, amount=$6, project_id=$7, updated_at=now() WHERE id=$1`,
    [id, d.spentOn, d.vendor, d.description, d.category, d.amount, d.projectId],
  );
  res.json(await one(`${EXPENSE_SELECT} WHERE e.id=$1`, [id]));
});

router.delete('/expenses/:id', requireAdmin, async (req, res) => {
  const row = await one('DELETE FROM expenses WHERE id=$1 RETURNING id', [parse(uuid, req.params.id)]);
  if (!row) throw notFound('Expense');
  res.status(204).end();
});

// ── Service catalog ──────────────────────────────────────────────────────────
const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Name the service.').max(200),
  description: z.string().trim().max(10000).default(''),
  unitPrice: z.coerce.number().int().min(0).max(1e11),
  unit: z.string().trim().min(1).max(100).default('project'),
});

router.get('/services', async (_req, res) => {
  res.json(await many('SELECT * FROM services ORDER BY archived, lower(name)'));
});

router.post('/services', async (req, res) => {
  const d = parse(serviceSchema, req.body);
  res.status(201).json(
    await one('INSERT INTO services(name, description, unit_price, unit, currency) VALUES($1,$2,$3,$4,$5) RETURNING *', [
      d.name, d.description, d.unitPrice, d.unit, await workspaceCurrency(),
    ]),
  );
});

router.patch('/services/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const current = await one('SELECT * FROM services WHERE id=$1', [id]);
  if (!current) throw notFound('Service');
  const d = parse(serviceSchema.extend({ archived: z.boolean().default(current.archived) }), {
    name: current.name, description: current.description, unitPrice: current.unit_price, unit: current.unit, ...req.body,
  });
  res.json(
    await one('UPDATE services SET name=$2, description=$3, unit_price=$4, unit=$5, archived=$6, updated_at=now() WHERE id=$1 RETURNING *', [
      id, d.name, d.description, d.unitPrice, d.unit, d.archived,
    ]),
  );
});

