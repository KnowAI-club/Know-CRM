'use client';
import { useState } from 'react';
import { GSTIN_PATTERN, gstinDetails } from '@know-crm/shared';
import { Button, Card, Field, useToast } from '@/components/ui';
import { ApiError, patch } from '@/lib/api';
import { fieldErrors } from '@/components/money/util';
import type { BillingSettings as Billing, WorkspaceSettings } from '@/components/money/types';
import { Section } from './shared';

const EMPTY: Required<Billing> = {
  address: '',
  gstin: '',
  email: '',
  phone: '',
  bankAccountName: '',
  bankName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankAccountType: '',
  terms: '',
};

export function BillingSettings({ settings, onSaved }: { settings: WorkspaceSettings; onSaved: (s: WorkspaceSettings) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Required<Billing>>({ ...EMPTY, ...settings.data.billing });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Billing) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const gst = form.gstin ? gstinDetails(form.gstin.toUpperCase()) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.gstin && !GSTIN_PATTERN.test(form.gstin.trim().toUpperCase()))
      errs['billing.gstin'] = 'This does not look like a valid 15-character GSTIN.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs['billing.email'] = 'Enter a valid email.';
    if (form.bankIfsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(form.bankIfsc.trim()))
      errs['billing.bankIfsc'] = 'IFSC is 11 characters, e.g. HDFC0001234.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      onSaved(await patch<WorkspaceSettings>('/settings', { billing: form }));
      toast.success('Billing details saved.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) => errors[`billing.${k}`];
  return (
    <Section title="Billing" description="Printed on every invoice: your address, tax registration, bank details and terms.">
      <form onSubmit={save} className="space-y-5">
        <Card title="Business">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Billing address" className="sm:col-span-2" error={err('address')}>
              <textarea className="input" rows={3} value={form.address} maxLength={1000} onChange={set('address')} />
            </Field>
            <Field label="GSTIN" hint={gst?.state ? `Registered in ${gst.state}` : 'Leave blank if not registered'} error={err('gstin')}>
              <input
                className="input uppercase"
                value={form.gstin}
                maxLength={20}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="Accounts email" error={err('email')}>
              <input type="email" className="input" value={form.email} onChange={set('email')} />
            </Field>
            <Field label="Phone" error={err('phone')}>
              <input className="input" value={form.phone} maxLength={50} onChange={set('phone')} />
            </Field>
          </div>
        </Card>
        <Card title="Bank account">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account name" error={err('bankAccountName')}>
              <input className="input" value={form.bankAccountName} maxLength={200} onChange={set('bankAccountName')} />
            </Field>
            <Field label="Bank" error={err('bankName')}>
              <input className="input" value={form.bankName} maxLength={200} onChange={set('bankName')} />
            </Field>
            <Field label="Account number" error={err('bankAccountNumber')}>
              <input className="input" value={form.bankAccountNumber} maxLength={50} onChange={set('bankAccountNumber')} />
            </Field>
            <Field label="IFSC" error={err('bankIfsc')}>
              <input
                className="input uppercase"
                value={form.bankIfsc}
                maxLength={20}
                onChange={(e) => setForm((f) => ({ ...f, bankIfsc: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="Account type" hint="e.g. Current" error={err('bankAccountType')}>
              <input className="input" value={form.bankAccountType} maxLength={100} onChange={set('bankAccountType')} />
            </Field>
          </div>
        </Card>
        <Card title="Terms">
          <Field label="Payment terms" hint="Shown at the foot of invoices" error={err('terms')}>
            <textarea className="input" rows={3} value={form.terms} maxLength={3000} onChange={set('terms')} />
          </Field>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save billing
          </Button>
        </div>
      </form>
    </Section>
  );
}
