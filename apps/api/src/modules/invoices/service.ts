import { z } from 'zod';
import { calculateTotals } from '@know-crm/shared';
import { many, one } from '../../db/pool.js';
import { badRequest } from '../../lib/errors.js';
import { zs } from '../../lib/validate.js';

const cents = z.coerce.number().int().min(0).max(1e11);
const bp = z.coerce.number().int().min(0).max(10000);

export const lineSchema = z
  .object({
    name: z.string().trim().max(500).default(''),
    description: z.string().max(20000).default(''),
    section: z.string().trim().max(200).default(''),
    unit: z.string().trim().min(1).max(100).default('unit'),
    quantity: z.coerce
      .number()
      .gt(0, 'Quantity must be more than 0')
      .max(100000)
      .refine((q) => Math.round(q * 100) === q * 100, 'Use at most 2 decimals'),
    unitPrice: cents,
    taxable: z.boolean().default(false),
  })
  .refine((l) => l.name.trim() || l.description.trim(), 'A service name or description is required.')
  .transform((l) => ({ ...l, name: l.name.trim() || l.description.trim().slice(0, 500) }));

export const installmentSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(200),
  amount: z.coerce.number().int().positive().max(1e11),
  dueDate: zs.date,
});

export const invoiceSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(500),
  heading: z.string().trim().min(1).max(200).default('Invoice'),
  introduction: z.string().max(20000).default(''),
  purchaseOrder: z.string().trim().max(200).default(''),
  taxLabel: z.string().trim().min(1).max(100).default('Tax'),
  serviceChargeLabel: z.string().trim().min(1).max(100).default('Service charge'),
  taxId: z.string().trim().max(100).default(''),
  sellerDetails: z.string().max(5000).default(''),
  buyerTaxId: z.string().trim().max(100).default(''),
  dueDate: zs.date,
  lines: z.array(lineSchema).min(1, 'Add at least one line').max(100),
  discountType: z.enum(['none', 'fixed', 'percent']).default('none'),
  discountValue: cents.default(0),
  serviceChargeRate: bp.default(0),
  taxRate: bp.default(0),
  taxComponents: z
    .array(z.object({ label: z.string().trim().min(1).max(60), rate: bp }))
    .max(8)
    .default([])
    .refine((c) => new Set(c.map((x) => x.label.toLowerCase())).size === c.length, 'Tax component labels must be unique.')
    .refine((c) => c.reduce((a, x) => a + x.rate, 0) <= 10000, 'Tax components cannot exceed 100%.'),
  installments: z.array(installmentSchema).min(1).max(24).optional(),
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;

/** Validates commercial rules and returns stored totals. */
export function calculateInvoice(data: InvoiceInput) {
  if (data.discountType === 'percent' && data.discountValue > 10000) throw badRequest('A percentage discount cannot exceed 100%.');
  const discountValue = data.discountType === 'none' ? 0 : data.discountValue;
  if (data.taxComponents.length && data.taxRate > 0)
    throw badRequest('Use either named tax components or the single tax rate, not both.');
  const totals = calculateTotals({ ...data, discountValue });
  if (data.discountType === 'fixed' && discountValue > totals.subtotal)
    throw badRequest('A discount cannot exceed the invoice subtotal.');
  const nums = [totals.subtotal, totals.discountAmount, totals.serviceChargeAmount, totals.taxAmount, totals.total];
  if (nums.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 1e11) || totals.total <= 0)
    throw badRequest('Invoice amounts must be within the supported limit and the total must be positive.');
  return { ...data, discountValue, ...totals };
}

export function normalizeInstallments(
  items: z.infer<typeof installmentSchema>[] | undefined,
  total: number,
  dueDate: string | null | undefined,
) {
  const plan = items?.length ? items : [{ label: 'Payment', amount: total, dueDate: dueDate ?? '' }];
  if (plan.reduce((a, i) => a + i.amount, 0) !== total)
    throw badRequest('Payment schedule amounts must add up exactly to the invoice total.');
  const ids = plan.map((p: any) => p.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw badRequest('Payment schedule IDs must be unique.');
  return plan;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Adds payments, instalment allocation and the derived status to stored invoices. */
export async function invoiceViews(where: string, params: unknown[], forClient = false): Promise<Record<string, any>[]> {
  const invoices = await many(
    `SELECT i.*, p.name AS project_name, c.name AS client_name FROM invoices i
       JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id
      WHERE ${where} ORDER BY i.created_at DESC`,
    params,
  );
  if (!invoices.length) return [];
  const ids = invoices.map((i) => i.id);
  const [lines, installments, payments, contacts] = await Promise.all([
    many('SELECT * FROM invoice_lines WHERE invoice_id = ANY($1) ORDER BY position', [ids]),
    many('SELECT * FROM invoice_installments WHERE invoice_id = ANY($1) ORDER BY position', [ids]),
    many(
      `SELECT pm.*, u.name AS recorded_by_name FROM payments pm LEFT JOIN users u ON u.id=pm.recorded_by
        WHERE invoice_id = ANY($1) ORDER BY received_date, created_at`,
      [ids],
    ),
    many(
      `SELECT i.id AS invoice_id, c.* FROM invoices i JOIN projects p ON p.id=i.project_id JOIN contacts c ON c.id=p.contact_id
        WHERE i.id = ANY($1) AND i.billed_to IS NULL`,
      [ids],
    ),
  ]);
  const day = today();
  return invoices.map((inv) => {
    const pays = payments.filter((p) => p.invoice_id === inv.id);
    const paid = pays.filter((p) => !p.reversed).reduce((a, p) => a + Number(p.amount), 0);
    const isVoid = inv.status === 'void';
    const balance = isVoid ? 0 : inv.total - paid;
    let remaining = paid;
    const plan = installments.filter((i) => i.invoice_id === inv.id);
    const items = (plan.length ? plan : [{ id: inv.id, label: 'Payment', amount: inv.total, due_date: inv.due_date }]).map((it) => {
      const itemPaid = Math.min(Number(it.amount), remaining);
      remaining -= itemPaid;
      const itemBalance = Number(it.amount) - itemPaid;
      const status = isVoid
        ? 'void'
        : itemBalance === 0
          ? 'paid'
          : inv.status !== 'draft' && it.due_date && it.due_date < day
            ? 'overdue'
            : 'upcoming';
      return { id: it.id, label: it.label, amount: Number(it.amount), due_date: it.due_date, paid: itemPaid, balance: isVoid ? 0 : itemBalance, status };
    });
    const overdue = items.some((i) => i.status === 'overdue');
    const status = isVoid
      ? 'void'
      : inv.status === 'draft'
        ? 'draft'
        : balance === 0
          ? 'paid'
          : paid > 0
            ? 'partial'
            : overdue
              ? 'overdue'
              : 'sent';
    const c = contacts.find((x) => x.invoice_id === inv.id);
    const billedTo =
      inv.billed_to ??
      (c && {
        name: c.billing_name || c.business_name || c.name,
        email: c.billing_email || c.business_email || c.email,
        company: c.business_name || c.company,
        address: c.billing_address || c.address || '',
      });
    const view = {
      ...inv,
      stored_status: inv.status,
      status,
      lines: lines.filter((l) => l.invoice_id === inv.id),
      installments: items,
      payments: forClient
        ? pays.map((p) => ({ id: p.id, amount: p.amount, method: p.method, received_date: p.received_date, reversed: p.reversed }))
        : pays,
      paid,
      balance,
      billed_to: billedTo,
      next_payment_due: isVoid ? null : (items.find((i) => i.balance > 0)?.due_date ?? null),
    };
    if (forClient) {
      delete (view as any).idempotency_key;
      delete (view as any).created_by;
    }
    return view;
  });
}

export const invoiceView = async (id: string, forClient = false) =>
  (await invoiceViews("i.id=$1", [id], forClient))[0] as Record<string, any> | undefined;

export const invoiceViewsForProject = (projectId: string, forClient: boolean) =>
  invoiceViews(`i.project_id=$1 ${forClient ? `AND i.status<>'draft'` : ''}`, [projectId], forClient);

export async function nextInvoiceNumber() {
  const r = await one<{ n: number }>(`SELECT nextval('invoice_number_seq')::int AS n`);
  return `INV-${String(r!.n).padStart(4, '0')}`;
}

export const auditAmount = (minor: number, currency: string) =>
  `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
