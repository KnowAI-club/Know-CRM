'use client';
import { useState, type FormEvent } from 'react';
import { ExternalLink, Link2, Trash2 } from 'lucide-react';
import { del, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { relative } from '@/lib/format';
import { Button, Card, ErrorBox, Field, Skeleton, useConfirm, useToast } from '@/components/ui';
import { fieldErrors } from './util';

interface Version {
  id: string;
  number: number;
  url: string;
  description: string;
  author_name: string | null;
  created_at: string;
}

/** Team-only delivery links (builds, previews, design files), numbered v1, v2… */
export function Versions({ projectId }: { projectId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Version[]>(`/projects/${projectId}/versions`, s), [projectId]);
  const [form, setForm] = useState({ url: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.url.trim()) return setErrors({ url: 'Paste a link.' });
    setSaving(true);
    try {
      const v = await post<Version>(`/projects/${projectId}/versions`, form);
      setData((list) => [v, ...(list ?? [])]);
      setForm({ url: '', description: '' });
      setErrors({});
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v: Version) => {
    if (!(await confirm({ title: `Remove v${v.number}?`, description: 'The link disappears from the project. This cannot be undone.', confirmLabel: 'Remove', danger: true })))
      return;
    try {
      await del(`/projects/${projectId}/versions/${v.id}`);
      setData((list) => list?.filter((x) => x.id !== v.id));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Card title="Versions" icon={<Link2 className="h-4 w-4" />}>
      <form onSubmit={add} className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start" noValidate>
        <Field label="Link" error={errors.url}>
          <input className="input" type="url" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        </Field>
        <Field label="What changed" error={errors.description}>
          <input className="input" value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Button type="submit" loading={saving} className="sm:mt-6">
          Add version
        </Button>
      </form>
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Skeleton className="h-10 w-full" />
      ) : !data?.length ? (
        <p className="text-sm text-mute">No versions yet. Add preview or build links for the team.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2">
              <span className="rounded-md bg-subtle px-1.5 py-0.5 text-xs font-semibold text-mute tabular-nums">v{v.number}</span>
              <div className="min-w-0 flex-1">
                <a href={v.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-acc hover:underline">
                  <span className="truncate">{v.description || v.url}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <p className="text-xs text-faint">
                  {v.author_name ?? 'Former teammate'} · {relative(v.created_at)}
                </p>
              </div>
              <Button size="icon" variant="ghost" aria-label={`Remove v${v.number}`} onClick={() => remove(v)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
