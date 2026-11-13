'use client';
import type { ReactNode } from 'react';
import { Field } from '@/components/ui';
import type { ContactForm, ContactKey } from './contact';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <legend className="eyebrow mb-3">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Shared contact form fields used by the create dialog and the client page. */
export function ContactFields({
  form,
  onChange,
  errors,
  locked = [],
  compact,
}: {
  form: ContactForm;
  onChange: (f: ContactForm) => void;
  errors: Record<string, string>;
  /** Fields the current user may not edit. */
  locked?: ContactKey[];
  /** Only the essentials (for the create dialog). */
  compact?: boolean;
}) {
  const input = (
    k: keyof ContactForm,
    label: string,
    opts: { type?: string; max?: number; hint?: string; required?: boolean; upper?: boolean } = {},
  ) => (
    <Field
      label={label}
      error={errors[k]}
      hint={locked.includes(k as ContactKey) ? 'Only an admin can change this.' : opts.hint}
      required={opts.required}
    >
      <input
        className={opts.upper ? 'input uppercase' : 'input'}
        type={opts.type ?? 'text'}
        maxLength={opts.max ?? 500}
        value={form[k]}
        disabled={locked.includes(k as ContactKey)}
        onChange={(e) => onChange({ ...form, [k]: e.target.value })}
      />
    </Field>
  );
  const area = (k: keyof ContactForm, label: string) => (
    <Field label={label} error={errors[k]} className="sm:col-span-2">
      <textarea className="input" rows={2} maxLength={1000} value={form[k]} onChange={(e) => onChange({ ...form, [k]: e.target.value })} />
    </Field>
  );

  return (
    <div className="space-y-6">
      <Group title="Contact">
        {input('name', 'Name', { required: true })}
        {input('email', 'Email', { type: 'email', max: 254 })}
        {input('company', 'Company')}
        {input('jobTitle', 'Job title', { max: 200 })}
        {input('phone', 'Phone', { type: 'tel', max: 40 })}
        {input('website', 'Website', { type: 'url', hint: 'Full link, e.g. https://example.com' })}
        {input('tags', 'Tags', { hint: 'Comma separated' })}
        {!compact && input('alternatePhones', 'Other phones', { hint: 'Comma separated, up to 5' })}
        {!compact && area('address', 'Address')}
      </Group>
      {!compact && (
        <>
          <Group title="Business">
            {input('businessName', 'Business name')}
            {input('businessEmail', 'Business email', { type: 'email', max: 254 })}
            {input('personalEmail', 'Personal email', { type: 'email', max: 254 })}
          </Group>
          <Group title="Point of contact">
            {input('pocName', 'Name')}
            {input('pocRole', 'Role')}
            {input('pocEmail', 'Email', { type: 'email', max: 254 })}
            {input('pocPhone', 'Phone', { type: 'tel', max: 40 })}
          </Group>
          <Group title="Billing & tax">
            {input('billingName', 'Billing name')}
            {input('billingEmail', 'Billing email', { type: 'email', max: 254 })}
            {input('gstin', 'GSTIN', { max: 15, upper: true, hint: '15 characters; PAN is derived when blank' })}
            {input('pan', 'PAN', { max: 10, upper: true })}
            {area('billingAddress', 'Billing address')}
          </Group>
        </>
      )}
    </div>
  );
}
