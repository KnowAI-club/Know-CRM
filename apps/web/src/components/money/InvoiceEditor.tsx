'use client';
import { useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { amountInWords, calculateTotals, lineAmount, percentLabel } from '@know-crm/shared';
import { Button, Card, Field, Menu, MoneyInput, Segmented, useToast } from '@/components/ui';
import { ApiError, patch, post } from '@/lib/api';
import { money } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { BillingSettings, Invoice, Service } from './types';
import { addDays, bpToPercent, fieldErrors, percentToBp, uuid } from './util';

interface LineDraft {
  key: string;
  name: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: number | null;
  taxable: boolean;
}
interface TaxDraft {
  key: string;
  label: string;
  rate: string;
}
interface InstallmentDraft {
  key: string;
  id?: string;
  label: string;
  amount: number | null;
  dueDate: string;
}

const blankLine = (taxable = true): LineDraft => ({
  key: uuid(),
  name: '',
  description: '',
  unit: 'unit',
  quantity: '1',
  unitPrice: null,
  taxable,
});

const GST_RATES = [5, 12, 18, 28];

function validQuantity(q: string) {
  const n = Number(q);
  return /^\d+(\.\d{1,2})?$/.test(q.trim()) && n > 0 && n <= 100000;
}

/** Create or edit a draft invoice; can also publish in the same save. */
export function InvoiceEditor({
  projectId,
  currency,
  invoice,
  billing,
  onSaved,
}: {
  projectId: string;
  currency: string;
  invoice?: Invoice;
  billing?: BillingSettings;
  onSaved: (inv: Invoice, published: boolean) => void;
}) {
  const toast = useToast();
  const services = useLoad((s) => get<Service[]>('/services', s), []);
  const [idempotencyKey] = useState(uuid);

  const [title, setTitle] = useState(invoice?.title ?? '');
  const [heading, setHeading] = useState(invoice?.heading ?? 'Tax Invoice');
  const [introduction, setIntroduction] = useState(invoice?.introduction ?? '');
  const [purchaseOrder, setPurchaseOrder] = useState(invoice?.purchase_order ?? '');
  const [dueDate, setDueDate] = useState(invoice?.due_date ?? addDays(new Date().toISOString().slice(0, 10), 15));
  const [taxId, setTaxId] = useState(invoice?.tax_id || billing?.gstin || '');
  const [buyerTaxId, setBuyerTaxId] = useState(invoice?.buyer_tax_id ?? '');
  const [sellerDetails, setSellerDetails] = useState(invoice?.seller_details ?? '');
  const [taxLabel, setTaxLabel] = useState(invoice?.tax_label ?? 'Tax');
  const [serviceChargeLabel, setServiceChargeLabel] = useState(invoice?.service_charge_label ?? 'Service charge');

  const [lines, setLines] = useState<LineDraft[]>(
    invoice?.lines.length
      ? invoice.lines.map((l) => ({
          key: uuid(),
          name: l.name,
          description: l.description,
          unit: l.unit,
          quantity: String(Number(l.quantity)),
          unitPrice: Number(l.unit_price),
          taxable: l.taxable,
        }))
      : [blankLine()],
  );
  const [discountType, setDiscountType] = useState<'none' | 'fixed' | 'percent'>(invoice?.discount_type ?? 'none');
  const [discountFixed, setDiscountFixed] = useState<number | null>(
    invoice?.discount_type === 'fixed' ? Number(invoice.discount_value) : 0,
  );
  const [discountPercent, setDiscountPercent] = useState(
    invoice?.discount_type === 'percent' ? bpToPercent(Number(invoice.discount_value)) : '',
  );
  const [serviceCharge, setServiceCharge] = useState(invoice?.service_charge_rate ? bpToPercent(invoice.service_charge_rate) : '');
  const [taxes, setTaxes] = useState<TaxDraft[]>(() => {
    if (invoice) {
      const comps = invoice.tax_components ?? [];
      if (comps.length) return comps.map((c) => ({ key: uuid(), label: c.label, rate: bpToPercent(c.rate) }));
      if (invoice.tax_rate) return [{ key: uuid(), label: invoice.tax_label || 'Tax', rate: bpToPercent(invoice.tax_rate) }];
      return [];
    }
    return [
      { key: uuid(), label: 'CGST', rate: '9' },
      { key: uuid(), label: 'SGST', rate: '9' },
    ];
  });
  const storedPlan = (invoice?.installments ?? []).filter((i) => i.id !== invoice?.id);
  const [split, setSplit] = useState(storedPlan.length > 1);
  const [plan, setPlan] = useState<InstallmentDraft[]>(
    storedPlan.length > 1
      ? storedPlan.map((i) => ({
          key: uuid(),
          id: i.id,
          label: i.label,
          amount: i.amount,
          dueDate: i.due_date ?? '',
        }))
      : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);

  const parsedTaxes = taxes.map((t) => ({ label: t.label.trim(), rate: percentToBp(t.rate) }));
  const discountValue =
    discountType === 'fixed' ? (discountFixed ?? 0) : discountType === 'percent' ? (percentToBp(discountPercent) ?? 0) : 0;
  const taxKey = JSON.stringify(parsedTaxes);
  const totals = useMemo(
    () =>
      calculateTotals({
        lines: lines.map((l) => ({
          quantity: validQuantity(l.quantity) ? Number(l.quantity) : 0,
          unitPrice: l.unitPrice ?? 0,
          taxable: l.taxable,
        })),
        discountType,
        discountValue,
        serviceChargeRate: percentToBp(serviceCharge) ?? 0,
        taxRate: 0,
        taxComponents: parsedTaxes.map((t) => ({ label: t.label, rate: t.rate ?? 0 })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, discountType, discountValue, serviceCharge, taxKey],
  );
  const planSum = plan.reduce((a, p) => a + (p.amount ?? 0), 0);

  const setLine = (key: string, patchLine: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patchLine } : l)));
  const setPlanItem = (key: string, p: Partial<InstallmentDraft>) => setPlan((ps) => ps.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const addService = (s: Service) => {
    setLines((ls) => {
      const item: LineDraft = {
        key: uuid(),
        name: s.name,
        description: s.description,
        unit: s.unit || 'unit',
        quantity: '1',
        unitPrice: s.unit_price,
        taxable: taxes.length > 0,
      };
      const onlyBlank = ls.length === 1 && !ls[0]!.name && !ls[0]!.description && !ls[0]!.unitPrice;
      return onlyBlank ? [item] : [...ls, item];
    });
  };

  const applyGst = (kind: 'intra' | 'inter' | 'none', rate = 18) => {
    if (kind === 'none') setTaxes([]);
    else if (kind === 'inter') setTaxes([{ key: uuid(), label: 'IGST', rate: String(rate) }]);
    else
      setTaxes([
        { key: uuid(), label: 'CGST', rate: String(rate / 2) },
        { key: uuid(), label: 'SGST', rate: String(rate / 2) },
      ]);
    if (kind !== 'none') setTaxLabel('GST');
  };

  const startSplit = () => {
    const half = Math.floor(totals.total / 2);
    setPlan([
      {
        key: uuid(),
        label: 'Advance',
        amount: half,
        dueDate: new Date().toISOString().slice(0, 10),
      },
      { key: uuid(), label: 'On completion', amount: totals.total - half, dueDate },
    ]);
    setSplit(true);
  };

  const balanceLast = () =>
    setPlan((ps) => {
      if (!ps.length) return ps;
      const rest = ps.slice(0, -1).reduce((a, p) => a + (p.amount ?? 0), 0);
      return ps.map((p, i) => (i === ps.length - 1 ? { ...p, amount: Math.max(totals.total - rest, 0) } : p));
    });

  const splitEvenly = () =>
    setPlan((ps) => {
      if (!ps.length) return ps;
      const each = Math.floor(totals.total / ps.length);
      return ps.map((p, i) => ({
        ...p,
        amount: i === ps.length - 1 ? totals.total - each * (ps.length - 1) : each,
      }));
    });

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Give the invoice a title.';
    if (!heading.trim()) e.heading = 'Required';
    lines.forEach((l, i) => {
      if (!l.name.trim() && !l.description.trim()) e[`lines.${i}.name`] = 'Name the service.';
      if (!validQuantity(l.quantity)) e[`lines.${i}.quantity`] = 'Quantity above 0, max 2 decimals.';
      if (l.unitPrice === null) e[`lines.${i}.unitPrice`] = 'Enter a valid price.';
      if (!l.unit.trim()) e[`lines.${i}.unit`] = 'Required';
    });
    if (discountType === 'percent' && percentToBp(discountPercent) === null) e.discountValue = 'Use a percentage from 0 to 100.';
    if (discountType === 'fixed' && discountFixed === null) e.discountValue = 'Enter a valid amount.';
    if (discountType === 'fixed' && (discountFixed ?? 0) > totals.subtotal) e.discountValue = 'A discount cannot exceed the subtotal.';
    if (percentToBp(serviceCharge) === null) e.serviceChargeRate = 'Use a percentage from 0 to 100.';
    parsedTaxes.forEach((t, i) => {
      if (!t.label) e[`taxComponents.${i}.label`] = 'Label required';
      if (t.rate === null) e[`taxComponents.${i}.rate`] = 'Invalid rate';
    });
    const labels = parsedTaxes.map((t) => t.label.toLowerCase());
    if (new Set(labels).size !== labels.length) e.taxComponents = 'Tax component labels must be unique.';
    if (parsedTaxes.reduce((a, t) => a + (t.rate ?? 0), 0) > 10000) e.taxComponents = 'Taxes cannot exceed 100%.';
    if (totals.total <= 0) e.total = 'The invoice total must be more than zero.';
    if (split) {
      plan.forEach((p, i) => {
        if (!p.label.trim()) e[`installments.${i}.label`] = 'Required';
        if (!p.amount || p.amount <= 0) e[`installments.${i}.amount`] = 'Amount above 0';
      });
      if (planSum !== totals.total)
        e.installments = `Instalments add up to ${money(planSum, currency)}; the total is ${money(totals.total, currency)}.`;
    }
    return e;
  }

  async function save(publish: boolean) {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error('Fix the highlighted fields before saving.');
      return;
    }
    const body = {
      title: title.trim(),
      heading: heading.trim(),
      introduction,
      purchaseOrder: purchaseOrder.trim(),
      taxLabel: taxLabel.trim() || 'Tax',
      serviceChargeLabel: serviceChargeLabel.trim() || 'Service charge',
      taxId: taxId.trim(),
      sellerDetails,
      buyerTaxId: buyerTaxId.trim(),
      dueDate: dueDate || '',
      lines: lines.map((l) => ({
        name: l.name.trim(),
        description: l.description,
        section: '',
        unit: l.unit.trim() || 'unit',
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice ?? 0,
        taxable: l.taxable,
      })),
      discountType,
      discountValue,
      serviceChargeRate: percentToBp(serviceCharge) ?? 0,
      taxRate: 0,
      taxComponents: parsedTaxes.map((t) => ({ label: t.label, rate: t.rate ?? 0 })),
      installments: split
        ? plan.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            label: p.label.trim(),
            amount: p.amount ?? 0,
            dueDate: p.dueDate || '',
          }))
        : [{ label: 'Payment', amount: totals.total, dueDate: dueDate || '' }],
    };
    setSaving(publish ? 'publish' : 'draft');
    try {
      let saved: Invoice;
      if (invoice) {
        saved = await patch<Invoice>(`/invoices/${invoice.id}`, publish ? { ...body, status: 'sent' } : body);
      } else {
        saved = await post<Invoice>(`/projects/${projectId}/invoices`, { ...body, idempotencyKey });
        if (publish) saved = await patch<Invoice>(`/invoices/${saved.id}`, { status: 'sent' });
      }
      toast.success(publish ? `Invoice ${saved.number} published to the client portal.` : `Draft ${saved.number} saved.`);
      onSaved(saved, publish);
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(null);
    }
  }

  const err = (k: string) => errors[k];
  const activeServices = (services.data ?? []).filter((s) => !s.archived);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required error={err('title')} className="sm:col-span-2">
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
                placeholder="Phase 1 · Design and build"
              />
            </Field>
            <Field label="Document heading" error={err('heading')}>
              <input className="input" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Due date" error={err('dueDate')}>
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Purchase order" hint="Optional client PO reference" error={err('purchaseOrder')}>
              <input className="input" value={purchaseOrder} onChange={(e) => setPurchaseOrder(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Client GSTIN / tax ID" hint="Defaults to the client record" error={err('buyerTaxId')}>
              <input
                className="input uppercase"
                value={buyerTaxId}
                onChange={(e) => setBuyerTaxId(e.target.value.toUpperCase())}
                maxLength={100}
              />
            </Field>
            <Field label="Your GSTIN / tax ID" error={err('taxId')}>
              <input className="input uppercase" value={taxId} onChange={(e) => setTaxId(e.target.value.toUpperCase())} maxLength={100} />
            </Field>
            <Field label="Seller details" hint="Leave empty to use the billing address from settings" error={err('sellerDetails')}>
              <textarea
                className="input"
                rows={2}
                value={sellerDetails}
                onChange={(e) => setSellerDetails(e.target.value)}
                maxLength={5000}
              />
            </Field>
            <Field label="Introduction" hint="Shown above the line items" className="sm:col-span-2" error={err('introduction')}>
              <textarea
                className="input"
                rows={2}
                value={introduction}
                onChange={(e) => setIntroduction(e.target.value)}
                maxLength={20000}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Line items"
          action={
            <div className="flex gap-2">
              {activeServices.length > 0 && (
                <Menu
                  trigger={(open) => (
                    <Button size="sm" variant="secondary" onClick={open}>
                      <BookOpen className="h-3.5 w-3.5" /> From catalog
                    </Button>
                  )}
                  items={activeServices.map((s) => ({
                    label: (
                      <span className="flex w-full justify-between gap-4">
                        <span className="truncate">{s.name}</span>
                        <span className="text-mute tabular-nums">{money(s.unit_price, s.currency)}</span>
                      </span>
                    ),
                    onSelect: () => addService(s),
                  }))}
                />
              )}
              <Button
                size="sm"
                variant="soft"
                onClick={() => setLines((ls) => [...ls, blankLine(taxes.length > 0)])}
                disabled={lines.length >= 100}
              >
                <Plus className="h-3.5 w-3.5" /> Line
              </Button>
            </div>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-line">
            {lines.map((l, i) => (
              <li key={l.key} className="grid gap-3 p-4 sm:grid-cols-12">
                <Field label="Service" error={err(`lines.${i}.name`) ?? err(`lines.${i}`)} className="sm:col-span-7">
                  <input className="input" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} maxLength={500} />
                </Field>
                <Field label="Quantity" error={err(`lines.${i}.quantity`)} className="sm:col-span-2">
                  <input
                    className="input text-right tabular-nums"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  />
                </Field>
                <Field label="Unit" error={err(`lines.${i}.unit`)} className="sm:col-span-3">
                  <input className="input" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} maxLength={100} />
                </Field>
                <Field label="Description" className="sm:col-span-7">
                  <textarea
                    className="input min-h-9"
                    rows={1}
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                    maxLength={20000}
                  />
                </Field>
                <Field label="Unit price" error={err(`lines.${i}.unitPrice`)} className="sm:col-span-3">
                  <MoneyInput value={l.unitPrice} currency={currency} onChange={(v) => setLine(l.key, { unitPrice: v })} />
                </Field>
                <div className="flex items-end justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
                  <label className="flex items-center gap-1.5 text-xs text-mute">
                    <input type="checkbox" checked={l.taxable} onChange={(e) => setLine(l.key, { taxable: e.target.checked })} /> Taxable
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium tabular-nums">
                      {money(
                        validQuantity(l.quantity)
                          ? lineAmount({
                              quantity: Number(l.quantity),
                              unitPrice: l.unitPrice ?? 0,
                            })
                          : 0,
                        currency,
                      )}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {err('lines') && <p className="px-4 pb-3 text-xs text-danger">{err('lines')}</p>}
        </Card>

        <Card title="Discount, charges and tax">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="label">Discount</span>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  value={discountType}
                  onChange={setDiscountType}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'fixed', label: 'Amount' },
                    { value: 'percent', label: '%' },
                  ]}
                />
                {discountType === 'fixed' && (
                  <div className="w-40">
                    <MoneyInput value={discountFixed} currency={currency} onChange={setDiscountFixed} />
                  </div>
                )}
                {discountType === 'percent' && (
                  <input
                    aria-label="Discount percent"
                    className="input w-24 text-right"
                    inputMode="decimal"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    placeholder="10"
                  />
                )}
              </div>
              {err('discountValue') && <p className="mt-1 text-xs text-danger">{err('discountValue')}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Service charge %" error={err('serviceChargeRate')}>
                <input
                  className="input text-right"
                  inputMode="decimal"
                  value={serviceCharge}
                  onChange={(e) => setServiceCharge(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Charge label">
                <input
                  className="input"
                  value={serviceChargeLabel}
                  onChange={(e) => setServiceChargeLabel(e.target.value)}
                  maxLength={100}
                />
              </Field>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="label mb-0 flex-1">Tax on taxable lines</span>
              <Menu
                trigger={(open) => (
                  <Button size="sm" variant="secondary" onClick={open}>
                    GST preset
                  </Button>
                )}
                items={[
                  ...GST_RATES.map((r) => ({
                    label: `CGST + SGST ${r}% (same state)`,
                    onSelect: () => applyGst('intra', r),
                  })),
                  ...GST_RATES.map((r) => ({
                    label: `IGST ${r}% (other state)`,
                    onSelect: () => applyGst('inter', r),
                  })),
                  { label: 'No tax', onSelect: () => applyGst('none') },
                ]}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={taxes.length >= 8}
                onClick={() => setTaxes((t) => [...t, { key: uuid(), label: '', rate: '' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Component
              </Button>
            </div>
            {taxes.length === 0 ? (
              <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-mute">No tax is applied.</p>
            ) : (
              <div className="space-y-2">
                {taxes.map((t, i) => (
                  <div key={t.key} className="flex items-start gap-2">
                    <div className="flex-1">
                      <input
                        aria-label="Tax label"
                        className="input"
                        value={t.label}
                        placeholder="CGST"
                        maxLength={60}
                        onChange={(e) => setTaxes((ts) => ts.map((x) => (x.key === t.key ? { ...x, label: e.target.value } : x)))}
                      />
                      {err(`taxComponents.${i}.label`) && <p className="mt-1 text-xs text-danger">{err(`taxComponents.${i}.label`)}</p>}
                    </div>
                    <div className="w-28">
                      <div className="relative">
                        <input
                          aria-label="Tax rate percent"
                          className="input pr-7 text-right"
                          inputMode="decimal"
                          value={t.rate}
                          placeholder="9"
                          onChange={(e) => setTaxes((ts) => ts.map((x) => (x.key === t.key ? { ...x, rate: e.target.value } : x)))}
                        />
                        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">%</span>
                      </div>
                      {err(`taxComponents.${i}.rate`) && <p className="mt-1 text-xs text-danger">{err(`taxComponents.${i}.rate`)}</p>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove tax component"
                      onClick={() => setTaxes((ts) => ts.filter((x) => x.key !== t.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Field label="Tax heading on invoice" className="max-w-xs">
                  <input className="input" value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} maxLength={100} />
                </Field>
              </div>
            )}
            {err('taxComponents') && <p className="mt-1 text-xs text-danger">{err('taxComponents')}</p>}
          </div>
        </Card>

        <Card
          title="Payment schedule"
          action={
            <Segmented
              value={split ? 'split' : 'single'}
              onChange={(v) => (v === 'split' ? (plan.length ? setSplit(true) : startSplit()) : setSplit(false))}
              options={[
                { value: 'single', label: 'Single payment' },
                { value: 'split', label: 'Instalments' },
              ]}
            />
          }
        >
          {!split ? (
            <p className="text-sm text-mute">
              The full {money(totals.total, currency)} is due {dueDate ? `on ${dueDate}` : 'on receipt'}.
            </p>
          ) : (
            <div className="space-y-3">
              {plan.map((p, i) => (
                <div key={p.key} className="grid items-start gap-2 sm:grid-cols-[1fr_160px_150px_auto]">
                  <Field label={i === 0 ? 'Label' : ''} error={err(`installments.${i}.label`)}>
                    <input
                      aria-label="Instalment label"
                      className="input"
                      value={p.label}
                      onChange={(e) => setPlanItem(p.key, { label: e.target.value })}
                      maxLength={200}
                    />
                  </Field>
                  <Field label={i === 0 ? 'Amount' : ''} error={err(`installments.${i}.amount`)}>
                    <MoneyInput value={p.amount} currency={currency} onChange={(v) => setPlanItem(p.key, { amount: v })} />
                  </Field>
                  <Field label={i === 0 ? 'Due' : ''}>
                    <input
                      aria-label="Instalment due date"
                      type="date"
                      className="input"
                      value={p.dueDate}
                      onChange={(e) => setPlanItem(p.key, { dueDate: e.target.value })}
                    />
                  </Field>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(i === 0 && 'sm:mt-5')}
                    aria-label="Remove instalment"
                    disabled={plan.length <= 1}
                    onClick={() => setPlan((ps) => ps.filter((x) => x.key !== p.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="soft"
                  disabled={plan.length >= 24}
                  onClick={() => setPlan((ps) => [...ps, { key: uuid(), label: `Instalment ${ps.length + 1}`, amount: 0, dueDate }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Instalment
                </Button>
                <Button size="sm" variant="ghost" onClick={splitEvenly}>
                  Split evenly
                </Button>
                <Button size="sm" variant="ghost" onClick={balanceLast}>
                  Put balance in last
                </Button>
                <span className={cn('ml-auto text-xs tabular-nums', planSum === totals.total ? 'text-ok' : 'text-danger')}>
                  {money(planSum, currency)} of {money(totals.total, currency)}
                </span>
              </div>
              {err('installments') && <p className="text-xs text-danger">{err('installments')}</p>}
            </div>
          )}
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card title="Summary">
          <dl className="space-y-2 text-sm">
            <Row label="Subtotal" value={money(totals.subtotal, currency)} />
            {totals.discountAmount > 0 && <Row label="Discount" value={`− ${money(totals.discountAmount, currency)}`} />}
            {totals.serviceChargeAmount > 0 && (
              <Row
                label={`${serviceChargeLabel || 'Service charge'} (${percentLabel(percentToBp(serviceCharge) ?? 0)})`}
                value={money(totals.serviceChargeAmount, currency)}
              />
            )}
            {totals.taxComponents.map((c, i) => (
              <Row key={i} label={`${c.label || 'Tax'} (${percentLabel(c.rate)})`} value={money(c.amount, currency)} />
            ))}
            <div className="border-t border-line pt-2">
              <Row
                label={<span className="font-semibold text-ink">Total</span>}
                value={<span className="text-base font-semibold">{money(totals.total, currency)}</span>}
              />
            </div>
          </dl>
          {totals.total > 0 && <p className="mt-2 text-xs text-faint">{amountInWords(totals.total, currency)}</p>}
          {err('total') && <p className="mt-2 text-xs text-danger">{err('total')}</p>}
          <div className="mt-4 grid gap-2">
            <Button onClick={() => save(true)} loading={saving === 'publish'} disabled={!!saving}>
              Save and publish
            </Button>
            <Button variant="secondary" onClick={() => save(false)} loading={saving === 'draft'} disabled={!!saving}>
              Save draft
            </Button>
          </div>
          <p className="mt-3 text-xs text-faint">Publishing shows the invoice in the client portal and locks it from further edits.</p>
        </Card>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-mute">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
