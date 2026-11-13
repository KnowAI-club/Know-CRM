'use client';
import { useState } from 'react';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@know-crm/shared';
import { Button, Field, Modal, MoneyInput, useToast, NumberInput } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { money, today } from '@/lib/format';
import type { Invoice } from './types';
import { addDays, fieldErrors, uuid } from './util';

/** Record a receipt against a published invoice. The key makes double-submits safe. */
export function PaymentModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: (inv: Invoice) => void }) {
  const toast = useToast();
  const next = invoice.installments.find((i) => i.balance > 0);
  const [key] = useState(uuid);
  const [amount, setAmount] = useState<number | null>(next?.balance ?? invoice.balance);
  const [method, setMethod] = useState<string>('bank_transfer');
  const [reference, setReference] = useState('');
  const [receivedDate, setReceivedDate] = useState(today());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!amount || amount <= 0) errs.amount = 'Enter an amount above zero.';
    else if (amount > invoice.balance) errs.amount = `The outstanding balance is ${money(invoice.balance, invoice.currency)}.`;
    if (!receivedDate) errs.receivedDate = 'Choose the date received.';
    else if (receivedDate > today()) errs.receivedDate = 'Use today or a past date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const inv = await post<Invoice>(`/invoices/${invoice.id}/payments`, {
        amount,
        method,
        reference,
        receivedDate,
        idempotencyKey: key,
      });
      toast.success(`Payment of ${money(amount!, invoice.currency)} recorded.`);
      onSaved(inv);
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record payment · ${invoice.number}`}
      description={`Outstanding ${money(invoice.balance, invoice.currency)}${next ? ` · next: ${next.label}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" loading={saving}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" required error={errors.amount}>
          <MoneyInput value={amount} currency={invoice.currency} onChange={setAmount} />
        </Field>
        <Field label="Received on" required error={errors.receivedDate}>
          <input type="date" className="input" max={today()} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
        <Field label="Method" error={errors.method}>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference" hint="UTR, cheque no. or note" error={errors.reference}>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={500} />
        </Field>
      </form>
    </Modal>
  );
}

/** Asks for a reason, then calls `action`. Used for voiding invoices and reversing payments. */
export function ReasonModal({
  title,
  description,
  confirmLabel,
  onClose,
  action,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  action: (reason: string) => Promise<void>;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError('Add a short reason for the audit trail.');
    setSaving(true);
    try {
      await action(reason.trim());
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="reason-form" loading={saving}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit}>
        <Field label="Reason" required error={error}>
          <textarea className="input" rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/** Creates a schedule that generates a new draft from this invoice each period. */
export function RecurringModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [interval, setRepeat] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [startDate, setStartDate] = useState(addDays(today(), 30));
  const [endDate, setEndDate] = useState('');
  const [dueDays, setDueDays] = useState('14');
  const [maxOccurrences, setMax] = useState('12');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!startDate) errs.startDate = 'Choose a start date.';
    if (endDate && endDate < startDate) errs.endDate = 'End date must be on or after the start date.';
    if (!/^\d+$/.test(dueDays) || Number(dueDays) > 90) errs.dueDays = 'Use 0–90 days.';
    if (!/^\d+$/.test(maxOccurrences) || Number(maxOccurrences) < 1 || Number(maxOccurrences) > 120) errs.maxOccurrences = 'Use 1–120.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await post(`/invoices/${invoice.id}/recurrence`, {
        interval,
        startDate,
        endDate,
        dueDays: Number(dueDays),
        maxOccurrences: Number(maxOccurrences),
      });
      toast.success('Recurring schedule created. Drafts appear on each run date for review.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Repeat this invoice"
      description="A new draft copy is created on each date. Drafts are never sent automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="recurring-form" loading={saving}>
            Create schedule
          </Button>
        </>
      }
    >
      <form id="recurring-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Repeat">
          <select className="input" value={interval} onChange={(e) => setRepeat(e.target.value as typeof interval)}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="First draft on" required error={errors.startDate}>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Stop after date" hint="Optional" error={errors.endDate}>
          <input type="date" className="input" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Maximum drafts" error={errors.maxOccurrences}>
          <NumberInput min={1} max={120} step={1} value={maxOccurrences} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <Field label="Due after (days)" error={errors.dueDays}>
          <NumberInput max={90} step={1} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
