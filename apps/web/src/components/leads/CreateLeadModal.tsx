'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Field, Modal, useToast } from '@/components/ui';
import { OptionSelect } from './OptionSelect';
import { OwnerSelect } from './OwnerSelect';
import { fieldErrors, type Lead } from './types';

interface Form {
  name: string;
  email: string;
  company: string;
  phone: string;
  website: string;
  source: string;
  industry: string;
  ownerId: string;
  funnel: 'inbound' | 'outbound';
  temperature: 'warm' | 'cold';
  budget: string;
  timeline: string;
  problem: string;
}

export function CreateLeadModal({
  open,
  onClose,
  sources,
  industries,
  onOptionsChanged,
}: {
  open: boolean;
  onClose: () => void;
  sources: string[];
  industries: string[];
  onOptionsChanged: () => void;
}) {
  const { user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const blank = (): Form => ({
    name: '',
    email: '',
    company: '',
    phone: '',
    website: '',
    source: '',
    industry: '',
    ownerId: user?.id ?? '',
    funnel: 'inbound',
    temperature: 'warm',
    budget: '',
    timeline: '',
    problem: '',
  });
  const [form, setForm] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const close = () => {
    setForm(blank());
    setErrors({});
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = 'Required';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = 'Enter a valid email';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const { name, email, ...data } = form;
      const lead = await post<Lead>('/leads', { name, email, data });
      toast.success('Lead created');
      close();
      router.push(`/leads/${lead.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New lead"
      description="Add a prospect to the pipeline. It starts in the first open stage."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="create-lead" loading={saving}>
            Create lead
          </Button>
        </>
      }
    >
      <form id="create-lead" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" required error={errors.name}>
          <input className="input" value={form.name} maxLength={300} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Email" required error={errors.email}>
          <input className="input" type="email" value={form.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Company" error={errors.company}>
          <input className="input" value={form.company} maxLength={300} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <input className="input" type="tel" value={form.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Website" error={errors.website} hint="Full link, e.g. https://example.com">
          <input className="input" type="url" value={form.website} maxLength={2000} onChange={(e) => set('website', e.target.value)} />
        </Field>
        <Field label="Owner" error={errors.ownerId}>
          <OwnerSelect value={form.ownerId} onChange={(v) => set('ownerId', v)} />
        </Field>
        <Field label="Source" error={errors.source}>
          <OptionSelect kind="source" value={form.source} options={sources} onChange={(v) => set('source', v)} onAdded={onOptionsChanged} />
        </Field>
        <Field label="Industry" error={errors.industry}>
          <OptionSelect
            kind="industry"
            value={form.industry}
            options={industries}
            onChange={(v) => set('industry', v)}
            onAdded={onOptionsChanged}
          />
        </Field>
        <Field label="Funnel">
          <select className="input" value={form.funnel} onChange={(e) => set('funnel', e.target.value as Form['funnel'])}>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </Field>
        <Field label="Temperature">
          <select className="input" value={form.temperature} onChange={(e) => set('temperature', e.target.value as Form['temperature'])}>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
        </Field>
        <Field label="Budget" error={errors.budget}>
          <input className="input" value={form.budget} maxLength={300} onChange={(e) => set('budget', e.target.value)} />
        </Field>
        <Field label="Timeline" error={errors.timeline}>
          <input className="input" value={form.timeline} maxLength={300} onChange={(e) => set('timeline', e.target.value)} />
        </Field>
        <Field label="Problem to solve" className="sm:col-span-2" error={errors.problem}>
          <textarea className="input" rows={3} value={form.problem} maxLength={10000} onChange={(e) => set('problem', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
