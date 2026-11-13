'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ExternalLink, FileText, MoreHorizontal, Pencil, Plus, RotateCcw } from 'lucide-react';
import { get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { relative } from '@/lib/format';
import { Button, Empty, ErrorBox, Field, Menu, Modal, PageHeader, Segmented, Skeleton, useToast } from '@/components/ui';
import { CopyLinkButton } from '@/components/growth/CopyButton';
import { fieldErrors, publicFormPath } from '@/components/growth/util';
import type { LeadForm } from '@/components/growth/types';
import { FormStatus } from '@/components/growth/FormStatus';

export default function LeadFormsPage() {
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad((s) => get<LeadForm[]>('/lead-forms', s));
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErrors({ title: 'Add a title.' });
    setSaving(true);
    try {
      const f = await post<LeadForm>('/lead-forms', {
        title: title.trim(),
        fields: [{ id: 'details', label: 'How can we help?', type: 'textarea', required: true }],
      });
      router.push(`/forms/${f.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
      setSaving(false);
    }
  };
  const setArchived = async (f: LeadForm, archived: boolean) => {
    try {
      await patch(`/lead-forms/${f.id}`, { archived });
      toast.success(archived ? 'Form archived. Its link stops accepting answers.' : 'Form restored.');
      await reload();
    } catch (err) {
      toast.error(err);
    }
  };

  const list = (data ?? []).filter((f) => (view === 'archived' ? f.archived : !f.archived));

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Lead forms"
        description="Share a form on your site or in messages. Every answer becomes a lead in the pipeline with an intake project."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New form
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </div>
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="card space-y-2 p-5">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty
            icon={<FileText className="h-5 w-5" />}
            title={view === 'archived' ? 'No archived forms' : 'No lead forms yet'}
            description={view === 'archived' ? undefined : 'Create a form, publish it, and share its link to start collecting inquiries.'}
            action={view === 'active' && <Button onClick={() => setCreating(true)}>New form</Button>}
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((f) => (
            <div key={f.id} className="card flex flex-col p-5">
              <div className="flex items-start gap-2">
                <Link href={`/forms/${f.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-semibold hover:text-acc">{f.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-mute">{f.description || `${f.fields.length} questions`}</p>
                </Link>
                <FormStatus form={f} />
                <Menu
                  trigger={(open) => (
                    <Button variant="ghost" size="icon" onClick={open} aria-label="Form actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  )}
                  items={[
                    { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => router.push(`/forms/${f.id}`) },
                    f.archived
                      ? { label: 'Restore', icon: <RotateCcw className="h-4 w-4" />, onSelect: () => setArchived(f, false) }
                      : { label: 'Archive', icon: <Archive className="h-4 w-4" />, onSelect: () => setArchived(f, true), danger: true },
                  ]}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-mute">
                <Link href={`/forms/${f.id}?tab=submissions`} className="font-medium text-ink hover:text-acc">
                  {f.submission_count} {f.submission_count === 1 ? 'submission' : 'submissions'}
                </Link>
                <span>· updated {relative(f.updated_at)}</span>
                <span className="flex-1" />
                {f.published_version && !f.archived && (
                  <>
                    <a href={publicFormPath(f.token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </a>
                    <CopyLinkButton path={publicFormPath(f.token)} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New lead form"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-form" loading={saving}>
              Create
            </Button>
          </>
        }
      >
        <form id="new-form" onSubmit={create}>
          <Field label="Title" required error={errors.title}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project inquiry" maxLength={200} />
          </Field>
        </form>
      </Modal>
    </>
  );
}
