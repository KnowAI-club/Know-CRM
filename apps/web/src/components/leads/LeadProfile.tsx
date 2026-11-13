'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { patch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Field, useToast } from '@/components/ui';
import { OptionSelect } from './OptionSelect';
import { OwnerSelect } from './OwnerSelect';
import { fieldErrors, isConflict, withDefaults, type Lead, type LeadData } from './types';

type Form = LeadData & { name: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <legend className="eyebrow mb-3">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Editable lead profile; only changed fields are sent, guarded by the lead version. */
export function LeadProfile({
  lead,
  sources,
  industries,
  onOptionsChanged,
  onSaved,
  onConflict,
}: {
  lead: Lead;
  sources: string[];
  industries: string[];
  onOptionsChanged: () => void;
  onSaved: (lead: Lead) => void;
  onConflict: () => void;
}) {
  const { isAdmin } = useSession();
  const toast = useToast();
  const initial = useMemo<Form>(() => ({ ...withDefaults(lead.data), name: lead.name }), [lead]);
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm(initial);
    setErrors({});
  }, [initial]);

  const readOnly = lead.state === 'won';
  const phoneLocked = !isAdmin && Boolean(initial.phone);
  const changed = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== initial[k]);
  const dirty = changed.length > 0;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const text = (k: keyof LeadData, label: string, opts: { type?: string; max?: number; hint?: string; disabled?: boolean } = {}) => (
    <Field label={label} error={errors[k]} hint={opts.hint}>
      <input
        className="input"
        type={opts.type ?? 'text'}
        maxLength={opts.max ?? 300}
        value={String(form[k] ?? '')}
        disabled={readOnly || opts.disabled}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );
  const area = (k: keyof LeadData, label: string) => (
    <Field label={label} error={errors[k]} className="sm:col-span-2">
      <textarea
        className="input"
        rows={3}
        maxLength={10000}
        value={String(form[k] ?? '')}
        disabled={readOnly}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );
  const choice = (k: keyof LeadData, label: string, opts: [string, string][]) => (
    <Field label={label} error={errors[k]}>
      <select className="input" value={String(form[k])} disabled={readOnly} onChange={(e) => set(k, e.target.value as never)}>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: 'Required' });
    const data: Partial<LeadData> = {};
    for (const k of changed) if (k !== 'name') (data as Record<string, unknown>)[k] = form[k];
    setSaving(true);
    try {
      const updated = await patch<Lead>(`/leads/${lead.id}`, {
        version: lead.version,
        ...(form.name !== initial.name ? { name: form.name.trim() } : {}),
        ...(Object.keys(data).length ? { data } : {}),
      });
      setErrors({});
      toast.success('Profile saved');
      onSaved(updated);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
      if (isConflict(err) && /changed/i.test((err as Error).message)) onConflict();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      {readOnly && (
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-mute">
          This lead has been handed off. Its sales profile is kept as a read-only record.
        </p>
      )}
      <Section title="Contact">
        <Field label="Name" required error={errors.name}>
          <input className="input" maxLength={300} value={form.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Email" hint="Email is the lead's identity and cannot be changed.">
          <input className="input" value={lead.email} disabled readOnly />
        </Field>
        {text('company', 'Company')}
        {text('phone', 'Phone', { type: 'tel', max: 40, disabled: phoneLocked, hint: phoneLocked ? 'Only an admin can change the phone.' : undefined })}
        {text('website', 'Website', { type: 'url', max: 2000 })}
        {text('socials', 'Social profiles', { max: 10000 })}
      </Section>

      <Section title="Qualification">
        <Field label="Owner" error={errors.ownerId}>
          <OwnerSelect
            value={form.ownerId}
            onChange={(v) => set('ownerId', v)}
            disabled={readOnly || Boolean(lead.nurture)}
            extra={lead.owner_name ? { id: initial.ownerId, name: lead.owner_name } : null}
          />
          {lead.nurture && <span className="mt-1 block text-xs text-faint">Change the POC from Nurture management.</span>}
        </Field>
        <Field label="Source" error={errors.source}>
          <OptionSelect kind="source" value={form.source} options={sources} onChange={(v) => set('source', v)} onAdded={onOptionsChanged} disabled={readOnly} />
        </Field>
        <Field label="Industry" error={errors.industry}>
          <OptionSelect kind="industry" value={form.industry} options={industries} onChange={(v) => set('industry', v)} onAdded={onOptionsChanged} disabled={readOnly} />
        </Field>
        {choice('funnel', 'Funnel', [['inbound', 'Inbound'], ['outbound', 'Outbound']])}
        {choice('temperature', 'Temperature', [['warm', 'Warm'], ['cold', 'Cold']])}
        {choice('qualifiedFit', 'Qualified fit', [['unknown', 'Unknown'], ['yes', 'Yes'], ['no', 'No']])}
        {choice('attendance', 'Attended discovery', [['unknown', 'Unknown'], ['yes', 'Yes'], ['no', 'No']])}
        {choice('outcome', 'Call outcome', [['none', 'Not recorded'], ['ideal', 'Ideal'], ['no_show', 'No-show'], ['ghost', 'Ghosted'], ['refused', 'Refused']])}
        {text('budget', 'Budget')}
        {text('timeline', 'Timeline')}
      </Section>

      <Section title="Needs">
        {area('problem', 'Problem to solve')}
        {area('goals', 'Goals')}
        {area('wants', 'What they want')}
        {area('description', 'Description')}
        {area('notes', 'Quick notes')}
      </Section>

      <Section title="Billing">
        {text('billingName', 'Billing name')}
        {text('billingEmail', 'Billing email', { type: 'email', max: 254 })}
        {text('taxId', 'GSTIN / tax ID', { hint: 'A valid GSTIN is copied to the client on close won.' })}
        {area('billingAddress', 'Billing address')}
      </Section>

      <Section title="Attribution">
        {text('utmSource', 'UTM source')}
        {text('utmMedium', 'UTM medium')}
        {text('utmCampaign', 'UTM campaign')}
      </Section>

      {!readOnly && (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-line bg-card/95 px-4 py-3 backdrop-blur">
          {dirty && <span className="mr-auto text-xs text-mute">Unsaved changes</span>}
          <Button variant="secondary" disabled={!dirty || saving} onClick={() => (setForm(initial), setErrors({}))}>
            Discard
          </Button>
          <Button type="submit" disabled={!dirty} loading={saving}>
            Save profile
          </Button>
        </div>
      )}
    </form>
  );
}
