'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { dateTime } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Field, PageHeader, Spinner, Tabs, useToast } from '@/components/ui';
import { CopyLinkButton } from '@/components/growth/CopyButton';
import { FormStatus } from '@/components/growth/FormStatus';
import { FormFieldInput } from '@/components/growth/FormFieldInput';
import { fieldErrors, publicFormPath } from '@/components/growth/util';
import { FIELD_TYPES, type FormField, type FormFieldType, type LeadForm } from '@/components/growth/types';

interface Draft extends Omit<FormField, 'options'> {
  key: string;
  optionsText: string;
}
interface Submission {
  id: string;
  name: string;
  email: string;
  answers: Record<string, string | boolean>;
  version: number;
  lead_id: string | null;
  created_at: string;
  fields: FormField[] | null;
}

const RESERVED = new Set(['name', 'email', 'constructor', 'prototype']);
let keySeq = 0;
const toDraft = (f: FormField): Draft => ({ ...f, key: `k${++keySeq}`, optionsText: (f.options ?? []).join('\n') });

function slug(label: string) {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(s) ? s : `q_${s || 'question'}`;
}

/** Turns drafts into API fields, giving new questions a stable id from their label. */
function toFields(drafts: Draft[]): FormField[] {
  const used = new Set(drafts.filter((d) => d.id).map((d) => d.id));
  return drafts.map((d) => {
    let id = d.id;
    if (!id) {
      const base = slug(d.label);
      id = base;
      for (let n = 2; used.has(id) || RESERVED.has(id); n++) id = `${base}_${n}`;
      used.add(id);
    }
    const options = d.optionsText.split('\n').map((o) => o.trim()).filter(Boolean);
    return { id, label: d.label.trim(), type: d.type, required: d.required, ...(d.type === 'select' ? { options } : {}) };
  });
}

function Builder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState<'build' | 'submissions'>(search.get('tab') === 'submissions' ? 'submissions' : 'build');
  const form = useLoad((s) => get<LeadForm>(`/lead-forms/${id}`, s), [id]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'save' | 'publish' | null>(null);

  useEffect(() => {
    if (!form.data || dirty) return;
    setTitle(form.data.title);
    setDescription(form.data.description);
    setDrafts(form.data.fields.map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const preview = useMemo(() => toFields(drafts), [drafts]);
  const change = (fn: (d: Draft[]) => Draft[]) => {
    setDrafts(fn);
    setDirty(true);
  };
  const update = (key: string, patchValue: Partial<Draft>) => change((list) => list.map((d) => (d.key === key ? { ...d, ...patchValue } : d)));
  const move = (i: number, dir: -1 | 1) =>
    change((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + dir, 0, item!);
      return next;
    });

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Add a title.';
    drafts.forEach((d, i) => {
      if (!d.label.trim()) errs[`fields.${i}.label`] = 'Every question needs a label.';
      if (d.type === 'select') {
        const opts = d.optionsText.split('\n').map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2 || new Set(opts).size !== opts.length) errs[`fields.${i}.options`] = 'Add 2–30 different options, one per line.';
      }
    });
    return errs;
  };

  const save = async (publish: boolean) => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return toast.error('Fix the highlighted questions first.');
    setSaving(publish ? 'publish' : 'save');
    try {
      let saved = await patch<LeadForm>(`/lead-forms/${id}`, { title: title.trim(), description: description.trim(), fields: preview });
      if (publish) saved = await post<LeadForm>(`/lead-forms/${id}/publish`);
      setDirty(false);
      form.setData(saved);
      setDrafts(saved.fields.map(toDraft));
      toast.success(publish ? 'Published. The public form now shows this version.' : 'Saved as draft.');
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e);
    } finally {
      setSaving(null);
    }
  };

  if (form.error) return <ErrorBox error={form.error} retry={form.reload} />;
  if (!form.data) return <Spinner />;
  const f = form.data;
  const live = !!f.published_version && !f.archived;

  return (
    <>
      <PageHeader
        back={{ href: '/forms', label: 'Lead forms' }}
        eyebrow="Lead form"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {f.title} <FormStatus form={f} />
          </span>
        }
        actions={
          <>
            {live && (
              <>
                <a href={publicFormPath(f.token)} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Button>
                </a>
                <CopyLinkButton path={publicFormPath(f.token)} />
              </>
            )}
            {tab === 'build' && !f.archived && (
              <>
                <Button variant="secondary" onClick={() => save(false)} loading={saving === 'save'} disabled={!!saving || !dirty}>
                  Save draft
                </Button>
                <Button onClick={() => save(true)} loading={saving === 'publish'} disabled={!!saving || (!dirty && !f.has_unpublished_changes && !!f.published_version)}>
                  Publish
                </Button>
              </>
            )}
          </>
        }
      />
      {f.archived && (
        <div className="mb-4 rounded-xl border border-line bg-subtle px-4 py-3 text-sm text-mute">
          This form is archived and its link does not accept answers. Restore it from the forms list to edit or publish.
        </div>
      )}
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace(t === 'build' ? `/forms/${id}` : `/forms/${id}?tab=submissions`);
        }}
        tabs={[
          { value: 'build', label: 'Questions' },
          { value: 'submissions', label: 'Submissions', count: f.submission_count },
        ]}
      />
      {tab === 'submissions' ? (
        <Submissions formId={id} current={f.fields} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <fieldset disabled={f.archived} className="space-y-4">
            <Card>
              <div className="space-y-3">
                <Field label="Title" required error={errors.title}>
                  <input className="input" value={title} onChange={(e) => (setTitle(e.target.value), setDirty(true))} maxLength={200} />
                </Field>
                <Field label="Introduction" hint="Shown above the questions.">
                  <textarea className="input" rows={3} value={description} onChange={(e) => (setDescription(e.target.value), setDirty(true))} maxLength={5000} />
                </Field>
                <p className="text-xs text-faint">Name and email are always asked first and are not listed below.</p>
              </div>
            </Card>
            {drafts.map((d, i) => (
              <Card key={d.key}>
                <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
                  <Field label={`Question ${i + 1}`} required error={errors[`fields.${i}.label`] ?? errors[`fields.${i}`]}>
                    <input className="input" value={d.label} onChange={(e) => update(d.key, { label: e.target.value })} maxLength={200} />
                  </Field>
                  <Field label="Answer type">
                    <select className="input" value={d.type} onChange={(e) => update(d.key, { type: e.target.value as FormFieldType })}>
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {d.type === 'select' && (
                  <Field className="mt-3" label="Options" hint="One per line." error={errors[`fields.${i}.options`]}>
                    <textarea className="input" rows={4} value={d.optionsText} onChange={(e) => update(d.key, { optionsText: e.target.value })} />
                  </Field>
                )}
                <div className="mt-3 flex items-center gap-1">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" checked={d.required} onChange={(e) => update(d.key, { required: e.target.checked })} className="h-4 w-4 accent-[var(--acc)]" />
                    Required
                  </label>
                  <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" disabled={i === drafts.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => change((l) => l.filter((x) => x.key !== d.key))} aria-label="Remove question">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
            {errors.fields && <p className="text-sm text-danger">{errors.fields}</p>}
            <Button
              variant="secondary"
              disabled={drafts.length >= 40}
              onClick={() => change((l) => [...l, { key: `k${++keySeq}`, id: '', label: '', type: 'text', required: false, optionsText: '' }])}
            >
              <Plus className="h-4 w-4" /> Add question
            </Button>
          </fieldset>
          <div className="lg:sticky lg:top-20 lg:self-start">
            <p className="eyebrow mb-2">Preview</p>
            <div className="card space-y-4 p-5">
              <div>
                <p className="font-semibold">{title || 'Untitled form'}</p>
                {description && <p className="mt-1 text-sm whitespace-pre-line text-mute">{description}</p>}
              </div>
              <div>
                <span className="label">Your name *</span>
                <input className="input" disabled />
              </div>
              <div>
                <span className="label">Email *</span>
                <input className="input" disabled />
              </div>
              {preview.map((q, i) =>
                q.type === 'checkbox' ? (
                  <FormFieldInput key={i} field={q} value={false} onChange={() => undefined} disabled />
                ) : (
                  <div key={i}>
                    <span className="label">
                      {q.label || 'Untitled question'}
                      {q.required && ' *'}
                    </span>
                    <FormFieldInput field={q} value="" onChange={() => undefined} disabled />
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Submissions({ formId, current }: { formId: string; current: FormField[] }) {
  const { data, error, loading, reload } = useLoad((s) => get<Submission[]>(`/lead-forms/${formId}/submissions`, s), [formId]);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data?.length)
    return (
      <div className="card">
        <Empty title="No submissions yet" description="Publish the form and share its link. Answers appear here and in Leads." />
      </div>
    );
  return (
    <div className="card divide-y divide-line">
      {data.map((s) => {
        const fields = s.fields ?? current;
        const expanded = open === s.id;
        return (
          <div key={s.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle" onClick={() => setOpen(expanded ? null : s.id)} aria-expanded={expanded}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate text-xs text-mute">{s.email}</p>
              </div>
              <span className="text-xs text-faint">v{s.version}</span>
              <span className="text-xs text-mute">{dateTime(s.created_at)}</span>
            </button>
            {expanded && (
              <div className="space-y-3 bg-subtle/50 px-4 pt-1 pb-4">
                {fields.map((f) => {
                  const v = s.answers[f.id];
                  return (
                    <div key={f.id}>
                      <p className="text-xs font-medium text-mute">{f.label}</p>
                      <p className="text-sm whitespace-pre-line">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v || '—'}</p>
                    </div>
                  );
                })}
                {s.lead_id && (
                  <a href={`/leads/${s.lead_id}`} className="inline-block text-sm text-acc underline">
                    Open lead
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function LeadFormBuilderPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Builder />
    </Suspense>
  );
}
