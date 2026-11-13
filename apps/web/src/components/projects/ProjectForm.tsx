'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTeam } from '@/lib/team';
import { Button, Field, Modal, MoneyInput, Segmented, useToast } from '@/components/ui';
import type { Project, ProjectStage } from './types';
import { fieldErrors } from './util';

interface Contact {
  id: string;
  name: string;
  company: string;
  email: string | null;
}

/** Create-project dialog: pick an existing client or add a new one inline. */
export function NewProjectModal({
  open,
  onClose,
  stages,
  defaultStage,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  stages: ProjectStage[];
  defaultStage?: string;
  onCreated: (p: Project) => void;
}) {
  const { user, currency } = useSession();
  const team = useTeam();
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [form, setForm] = useState({
    name: '',
    contactId: '',
    stage: defaultStage || 'inquiry',
    value: 0 as number | null,
    dueDate: '',
    ownerId: '',
    description: '',
  });
  const [contact, setContact] = useState({ name: '', email: '', company: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm((f) => ({ ...f, stage: defaultStage || stages.find((s) => s.category === 'inquiry')?.id || 'inquiry', ownerId: f.ownerId || user?.id || '' }));
    get<Contact[]>('/contacts')
      .then((list) => {
        setContacts(list);
        if (!list.length) setMode('new');
      })
      .catch(() => setContacts([]));
  }, [open, defaultStage, stages, user?.id]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = 'Name the project.';
    if (form.value === null) local.value = 'Enter a valid amount.';
    if (mode === 'existing' && !form.contactId) local.contactId = 'Choose a client.';
    if (mode === 'new' && !contact.name.trim()) local['contact.name'] = 'Enter the client name.';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      let contactId = form.contactId;
      if (mode === 'new') {
        try {
          const c = await post<Contact>('/contacts', contact);
          contactId = c.id;
          setContacts((list) => [c, ...(list ?? [])]);
          setMode('existing');
          setForm((f) => ({ ...f, contactId: c.id }));
        } catch (err) {
          const f = fieldErrors(err);
          setErrors(Object.fromEntries(Object.entries(f).map(([k, v]) => [`contact.${k}`, v])));
          throw err;
        }
      }
      const project = await post<Project>('/projects', { ...form, contactId, value: form.value ?? 0, ownerId: form.ownerId || undefined });
      toast.success('Project created');
      onCreated(project);
      setForm((f) => ({ ...f, name: '', contactId: '', value: 0, dueDate: '', description: '' }));
      setContact({ name: '', email: '', company: '' });
    } catch (err) {
      setErrors((prev) => ({ ...prev, ...fieldErrors(err) }));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="Projects track delivery, files, invoices and the client portal."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-project" loading={saving}>
            Create project
          </Button>
        </>
      }
    >
      <form id="new-project" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Project name" required error={errors.name} className="sm:col-span-2">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={500} />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label mb-0">Client</span>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'existing', label: 'Existing' },
                { value: 'new', label: 'New client' },
              ]}
            />
          </div>
          {mode === 'existing' ? (
            <Field label="Choose client" error={errors.contactId}>
              <select className="input" value={form.contactId} onChange={(e) => set('contactId', e.target.value)} disabled={!contacts}>
                <option value="">{contacts ? 'Select a client…' : 'Loading clients…'}</option>
                {contacts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` · ${c.company}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="grid gap-3 rounded-xl border border-line bg-subtle/40 p-3 sm:grid-cols-3">
              <Field label="Name" required error={errors['contact.name']}>
                <input className="input" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              </Field>
              <Field label="Email" error={errors['contact.email']}>
                <input className="input" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </Field>
              <Field label="Company" error={errors['contact.company']}>
                <input className="input" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        <Field label="Stage" error={errors.stage}>
          <select className="input" value={form.stage} onChange={(e) => set('stage', e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Value" error={errors.value}>
          <MoneyInput value={form.value} onChange={(v) => set('value', v)} currency={currency} />
        </Field>
        <Field label="Due date" error={errors.dueDate}>
          <input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Owner" error={errors.ownerId}>
          <select className="input" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" error={errors.description} className="sm:col-span-2">
          <textarea className="input" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={20000} />
        </Field>
      </form>
    </Modal>
  );
}
