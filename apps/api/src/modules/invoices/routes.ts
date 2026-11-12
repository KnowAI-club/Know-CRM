import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS } from '@know-crm/shared';
import { many, one, query, transaction } from '../../db/pool.js';
import { parse, zs } from '../../lib/validate.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { projectActivity } from '../../lib/activity.js';
import { isoDay, minorToDecimal, sendCsv } from '../../lib/csv.js';
import { currentUser, requireStaff, type SessionUser } from '../../middleware/auth.js';
import { projectFor } from '../projects/access.js';
import {
  auditAmount, calculateInvoice, invoiceSchema, invoiceView, invoiceViews, nextInvoiceNumber,
  normalizeInstallments, type InvoiceInput,
} from './service.js';

export const router = Router();
const idParam = z.object({ id: z.string().uuid() });

async function writeInvoiceChildren(id: string, data: ReturnType<typeof calculateInvoice>, plan: ReturnType<typeof normalizeInstallments>) {
  await query('DELETE FROM invoice_lines WHERE invoice_id=$1', [id]);
  await query('DELETE FROM invoice_installments WHERE invoice_id=$1', [id]);
  for (const [i, l] of data.lines.entries())
    await query(
      `INSERT INTO invoice_lines(invoice_id,position,name,description,section,unit,quantity,unit_price,taxable) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, i, l.name, l.description, l.section, l.unit, l.quantity, l.unitPrice, l.taxable],
    );
  for (const [i, p] of plan.entries())
    await query(
      `INSERT INTO invoice_installments(id,invoice_id,position,label,amount,due_date) VALUES(COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6)`,
      [(p as any).id ?? null, id, i, p.label, p.amount, p.dueDate || null],
    );
}

/** Inserts a draft invoice (used by the API and the recurring job). */
export async function createDraft(actor: Pick<SessionUser, 'id' | 'name'> & { role?: string }, projectId: string, input: InvoiceInput, key?: string) {
  const project = await one('SELECT p.currency, c.gstin FROM projects p JOIN contacts c ON c.id=p.contact_id WHERE p.id=$1', [projectId]);
  if (!project) throw notFound('Project');
  const data = calculateInvoice(input);
  const plan = normalizeInstallments(data.installments, data.total, data.dueDate);
  const number = await nextInvoiceNumber();
  const inv = await one(
    `INSERT INTO invoices(project_id, number, title, heading, introduction, purchase_order, tax_label, service_charge_label, tax_id,
        seller_details, buyer_tax_id, subtotal, discount_type, discount_value, discount_amount, service_charge_rate,
        service_charge_amount, tax_rate, tax_amount, tax_components, total, currency, due_date, idempotency_key, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
    [
      projectId, number, data.title, data.heading, data.introduction, data.purchaseOrder, data.taxLabel, data.serviceChargeLabel,
      data.taxId, data.sellerDetails, data.buyerTaxId || project.gstin || '', data.subtotal, data.discountType, data.discountValue,
      data.discountAmount, data.serviceChargeRate, data.serviceChargeAmount, data.taxRate, data.taxAmount,
      JSON.stringify(data.taxComponents), data.total, project.currency, data.dueDate || null, key ?? null, actor.id,
    ],
  );
  await writeInvoiceChildren(inv!.id, data, plan);
  await projectActivity(actor, projectId, `Draft invoice ${number} created: ${data.title}, ${auditAmount(data.total, project.currency)}`);
  return inv!.id as string;
}

router.get('/invoices', async (req, res) => {
  const me = currentUser(req);
  if (me.role === 'client')
    return res.json(
      await invoiceViews(
        `i.status<>'draft' AND EXISTS (SELECT 1 FROM project_access a WHERE a.project_id=i.project_id AND a.user_id=$1)`,
        [me.id],
        true,
      ),
    );
  res.json(await invoiceViews('true', []));
});

router.get('/invoices/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const inv = await one('SELECT project_id, status FROM invoices WHERE id=$1', [id]);
  if (!inv) throw notFound('Invoice');
  await projectFor(req, inv.project_id);
  if (me.role === 'client' && inv.status === 'draft') throw notFound('Invoice');
  res.json(await invoiceView(id, me.role === 'client'));
});

router.post('/projects/:id/invoices', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  await projectFor(req, id, true);
  const body = parse(invoiceSchema.extend({ idempotencyKey: z.string().min(8).max(128).optional() }), req.body);
  const { idempotencyKey, ...input } = body;
  const invoiceId = await transaction(async () => {
    if (idempotencyKey) {
      const existing = await one('SELECT id, project_id FROM invoices WHERE idempotency_key=$1', [idempotencyKey]);
      if (existing) {
        if (existing.project_id !== id) throw conflict('This invoice request key was already used for different details.');
        return existing.id as string;
      }
    }
    return createDraft(me, id, input, idempotencyKey);
  });
  res.status(201).json(await invoiceView(invoiceId));
});

router.patch('/invoices/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(invoiceSchema.partial().extend({ status: z.literal('sent').optional() }), req.body);
  for (const k of Object.keys(data)) if (!(k in req.body)) delete (data as any)[k];
  if (!Object.keys(data).length) throw badRequest('Provide invoice changes.');
  await transaction(async () => {
    const current = await invoiceView(id);
    if (!current) throw notFound('Invoice');
    await projectFor(req, current.project_id, true);
    if (current.stored_status === 'void') throw conflict('Void invoices cannot be changed or republished.');
    const commercial = Object.keys(data).filter((k) => k !== 'status');
    if (current.stored_status === 'sent') {
      if (commercial.length) throw conflict('Published invoices cannot be edited. Create a new draft instead.');
      return;
    }
    const merged: InvoiceInput = {
      title: current.title, heading: current.heading, introduction: current.introduction, purchaseOrder: current.purchase_order,
      taxLabel: current.tax_label, serviceChargeLabel: current.service_charge_label, taxId: current.tax_id,
      sellerDetails: current.seller_details, buyerTaxId: current.buyer_tax_id, dueDate: current.due_date ?? '',
      lines: current.lines.map((l: any) => ({
        name: l.name, description: l.description, section: l.section, unit: l.unit, quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price), taxable: l.taxable,
      })),
      discountType: current.discount_type, discountValue: Number(current.discount_value),
      serviceChargeRate: current.service_charge_rate, taxRate: current.tax_rate,
      taxComponents: (current.tax_components ?? []).map((c: any) => ({ label: c.label, rate: c.rate })),
      ...data,
    };
    const calc = calculateInvoice(merged);
    let items = data.installments;
    if (!items) {
      const existing = current.installments;
      items =
        existing.length <= 1
          ? [{ id: existing[0]?.id !== current.id ? existing[0]?.id : undefined, label: existing[0]?.label ?? 'Payment', amount: calc.total, dueDate: calc.dueDate ?? '' }]
          : existing.map((i: any) => ({ id: i.id, label: i.label, amount: i.amount, dueDate: i.due_date ?? '' }));
    }
    const plan = normalizeInstallments(items, calc.total, calc.dueDate);
    const publish = data.status === 'sent';
    await query(
      `UPDATE invoices SET title=$2, heading=$3, introduction=$4, purchase_order=$5, tax_label=$6, service_charge_label=$7,
         tax_id=$8, seller_details=$9, buyer_tax_id=$10, subtotal=$11, discount_type=$12, discount_value=$13, discount_amount=$14,
         service_charge_rate=$15, service_charge_amount=$16, tax_rate=$17, tax_amount=$18, tax_components=$19, total=$20,
         due_date=$21, status=$22, issued_at=CASE WHEN $23 THEN now() ELSE issued_at END,
         billed_to=CASE WHEN $23 THEN $24::jsonb ELSE billed_to END, updated_at=now()
       WHERE id=$1`,
      [
        id, calc.title, calc.heading, calc.introduction, calc.purchaseOrder, calc.taxLabel, calc.serviceChargeLabel, calc.taxId,
        calc.sellerDetails, calc.buyerTaxId, calc.subtotal, calc.discountType, calc.discountValue, calc.discountAmount,
        calc.serviceChargeRate, calc.serviceChargeAmount, calc.taxRate, calc.taxAmount, JSON.stringify(calc.taxComponents),
        calc.total, calc.dueDate || null, publish ? 'sent' : 'draft', publish, JSON.stringify(current.billed_to ?? null),
      ],
    );
    await writeInvoiceChildren(id, calc, plan);
    await projectActivity(
      me,
      current.project_id,
      publish
        ? `Invoice ${current.number} published to client portal (${auditAmount(calc.total, current.currency)})`
        : `Draft invoice ${current.number} updated (${auditAmount(calc.total, current.currency)})`,
    );
  });
  res.json(await invoiceView(id));
});

router.delete('/invoices/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const inv = await one('SELECT * FROM invoices WHERE id=$1', [id]);
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'draft') throw conflict('Only draft invoices can be deleted. Void an issued invoice instead.');
  if (await one('SELECT 1 FROM recurring_invoices WHERE source_invoice_id=$1', [id]))
    throw conflict('A recurring schedule uses this draft as its template.');
  await transaction(async () => {
    await query('DELETE FROM recurring_invoice_runs WHERE invoice_id=$1', [id]);
    await query('DELETE FROM invoices WHERE id=$1', [id]);
    await projectActivity(me, inv.project_id, `Draft invoice ${inv.number} deleted`);
  });
  res.json({ ok: true });
});

router.post('/invoices/:id/void', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
  await transaction(async () => {
    const inv = await invoiceView(id);
    if (!inv) throw notFound('Invoice');
    if (inv.stored_status === 'void') return;
    if (inv.stored_status !== 'sent') throw conflict('Only issued invoices can be voided.');
    if (inv.paid > 0) throw conflict('Reverse active receipts before voiding an invoice.');
    await query(`UPDATE invoices SET status='void', voided_at=now(), voided_by=$2, void_reason=$3 WHERE id=$1`, [id, me.id, reason]);
    await projectActivity(me, inv.project_id, `Invoice ${inv.number} voided: ${reason}`);
  });
  res.json(await invoiceView(id));
});

router.post('/invoices/:id/payments', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(
    z.object({
      amount: z.coerce.number().int().positive().max(1e11),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().trim().max(500).default(''),
      receivedDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .refine((d) => d <= isoDay(), 'Use today or a past date.'),
      idempotencyKey: z.string().min(8).max(128),
    }),
    req.body,
  );
  await transaction(async () => {
    await query('SELECT 1 FROM invoices WHERE id=$1 FOR UPDATE', [id]);
    const prior = await one('SELECT * FROM payments WHERE idempotency_key=$1', [data.idempotencyKey]);
    if (prior) {
      if (prior.invoice_id !== id || Number(prior.amount) !== data.amount)
        throw conflict('This payment key was already used for a different request.');
      return;
    }
    const inv = await invoiceView(id);
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'void') throw conflict('Void invoices cannot receive payments.');
    if (inv.status === 'draft') throw conflict('Publish the invoice before recording a payment.');
    if (data.amount > inv.balance) throw conflict('Payment exceeds the outstanding balance.');
    await query(
      `INSERT INTO payments(invoice_id,amount,method,reference,received_date,idempotency_key,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, data.amount, data.method, data.reference, data.receivedDate, data.idempotencyKey, me.id],
    );
    await projectActivity(me, inv.project_id, `Payment of ${auditAmount(data.amount, inv.currency)} recorded for ${inv.number}`);
  });
  res.status(201).json(await invoiceView(id));
});

router.post('/payments/:id/reverse', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
  const payment = await one('SELECT pm.*, i.number, i.project_id, i.currency FROM payments pm JOIN invoices i ON i.id=pm.invoice_id WHERE pm.id=$1', [id]);
  if (!payment) throw notFound('Payment');
  if (payment.reversed) throw conflict('This payment is already reversed.');
  await query('UPDATE payments SET reversed=true, reversal_reason=$2, reversed_at=now(), reversed_by=$3 WHERE id=$1', [id, reason, me.id]);
  await projectActivity(me, payment.project_id, `Payment of ${auditAmount(payment.amount, payment.currency)} on ${payment.number} reversed: ${reason}`);
  res.json(await invoiceView(payment.invoice_id));
});

/* ---------- Recurring drafts ---------- */

router.get('/recurring-invoices', requireStaff, async (_req, res) => {
  res.json(
    await many(
      `SELECT r.id, r.project_id, r.source_invoice_id, r.interval, r.start_date, r.next_date, r.end_date, r.due_days,
              r.max_occurrences, r.generated, r.state, r.created_at, i.number AS source_number, i.title AS source_title, p.name AS project_name
         FROM recurring_invoices r JOIN invoices i ON i.id=r.source_invoice_id JOIN projects p ON p.id=r.project_id
        ORDER BY r.created_at DESC`,
    ),
  );
});

router.post('/invoices/:id/recurrence', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const data = parse(
    z
      .object({
        interval: z.enum(['weekly', 'monthly', 'yearly']),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
        endDate: zs.date,
        dueDays: z.coerce.number().int().min(0).max(90).default(14),
        maxOccurrences: z.coerce.number().int().min(1).max(120).default(12),
      })
      .refine((d) => !d.endDate || d.endDate >= d.startDate, { message: 'End date must be on or after the start date.', path: ['endDate'] }),
    req.body,
  );
  const inv = await invoiceView(id);
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'void') throw conflict('A void invoice cannot seed recurring drafts.');
  const template = {
    title: inv.title, heading: inv.heading, introduction: inv.introduction, purchaseOrder: inv.purchase_order,
    taxLabel: inv.tax_label, serviceChargeLabel: inv.service_charge_label, taxId: inv.tax_id, sellerDetails: inv.seller_details,
    buyerTaxId: inv.buyer_tax_id, discountType: inv.discount_type, discountValue: Number(inv.discount_value),
    serviceChargeRate: inv.service_charge_rate, taxRate: inv.tax_rate,
    taxComponents: (inv.tax_components ?? []).map((c: any) => ({ label: c.label, rate: c.rate })),
    lines: inv.lines.map((l: any) => ({
      name: l.name, description: l.description, section: l.section, unit: l.unit, quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price), taxable: l.taxable,
    })),
  };
  const row = await one(
    `INSERT INTO recurring_invoices(project_id, source_invoice_id, created_by, template, interval, start_date, next_date, end_date, due_days, max_occurrences)
     VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING *`,
    [inv.project_id, id, me.id, JSON.stringify(template), data.interval, data.startDate, data.endDate || null, data.dueDays, data.maxOccurrences],
  );
  await projectActivity(me, inv.project_id, `Recurring draft schedule created from ${inv.number} (${data.interval})`);
  res.status(201).json(row);
});

router.patch('/recurring-invoices/:id', requireStaff, async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const { state } = parse(z.object({ state: z.enum(['active', 'paused', 'cancelled']) }), req.body);
  const row = await one('SELECT * FROM recurring_invoices WHERE id=$1', [id]);
  if (!row) throw notFound('Schedule');
  if (['completed', 'cancelled'].includes(row.state))
    throw conflict('A completed or cancelled schedule cannot resume. Create a new schedule.');
  const updated = await one('UPDATE recurring_invoices SET state=$2, updated_at=now() WHERE id=$1 RETURNING *', [id, state]);
  await projectActivity(me, row.project_id, `Recurring draft schedule ${state}`);
  res.json(updated);
});

/** Each occurrence is computed from the start so dates never drift (Jan 31 → Feb 28 → Mar 31). */
export function occurrenceDate(start: string, interval: string, i: number) {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  if (interval === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7 * i)).toISOString().slice(0, 10);
  const months = interval === 'monthly' ? i : 12 * i;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Worker job: create drafts for due recurring schedules. */
export async function runRecurringInvoices(limit = 100) {
  const day = isoDay();
  for (let n = 0; n < limit; n++) {
    const done = await transaction(async () => {
      const s = await one(
        `SELECT * FROM recurring_invoices WHERE state='active' AND next_date <= $1 ORDER BY next_date, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [day],
      );
      if (!s) return true;
      if (s.generated >= s.max_occurrences || (s.end_date && s.next_date > s.end_date)) {
        await query(`UPDATE recurring_invoices SET state='completed', updated_at=now() WHERE id=$1`, [s.id]);
        return false;
      }
      if (!(await one('SELECT 1 FROM recurring_invoice_runs WHERE schedule_id=$1 AND period_date=$2', [s.id, s.next_date]))) {
        const due = new Date(`${s.next_date}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + s.due_days);
        const input = invoiceSchema.parse({ ...s.template, dueDate: due.toISOString().slice(0, 10) });
        const invoiceId = await createDraft({ id: s.created_by, name: 'Scheduled billing' }, s.project_id, input);
        await query('INSERT INTO recurring_invoice_runs(schedule_id, period_date, invoice_id) VALUES($1,$2,$3)', [s.id, s.next_date, invoiceId]);
      }
      const generated = s.generated + 1;
      const nextDate = occurrenceDate(s.start_date, s.interval, generated);
      const completed = generated >= s.max_occurrences || (s.end_date && nextDate > s.end_date);
      await query(`UPDATE recurring_invoices SET generated=$2, next_date=$3, state=$4, updated_at=now() WHERE id=$1`, [
        s.id, generated, nextDate, completed ? 'completed' : 'active',
      ]);
      return false;
    });
    if (done) break;
  }
}

/* ---------- Exports ---------- */

router.get('/exports/invoices.csv', requireStaff, async (_req, res) => {
  const rows = (await invoiceViews(`i.status NOT IN ('draft','void')`, [])).reverse();
  sendCsv(
    res,
    `invoices-${isoDay()}.csv`,
    ['Number', 'Title', 'Project', 'Status', 'Due date', 'Subtotal', 'Discount', 'Service charge', 'Tax', 'Total', 'Paid', 'Balance', 'Currency'],
    rows.map((i) => [
      i.number, i.title, i.project_name, i.status, i.due_date ?? '', minorToDecimal(i.subtotal), minorToDecimal(i.discount_amount),
      minorToDecimal(i.service_charge_amount), minorToDecimal(i.tax_amount), minorToDecimal(i.total), minorToDecimal(i.paid),
      minorToDecimal(i.balance), i.currency,
    ]),
  );
});

router.get('/exports/payments.csv', requireStaff, async (_req, res) => {
  const rows = await many(
    `SELECT pm.*, i.number, i.currency, p.name AS project FROM payments pm JOIN invoices i ON i.id=pm.invoice_id
       JOIN projects p ON p.id=i.project_id WHERE i.status NOT IN ('draft','void') ORDER BY pm.received_date DESC`,
  );
  sendCsv(
    res,
    `payments-${isoDay()}.csv`,
    ['Received', 'Invoice', 'Project', 'Method', 'Reference', 'Amount', 'Currency', 'Status', 'Reversal reason'],
    rows.map((r) => [r.received_date, r.number, r.project, r.method, r.reference, minorToDecimal(r.amount), r.currency, r.reversed ? 'reversed' : 'recorded', r.reversal_reason ?? '']),
  );
});
