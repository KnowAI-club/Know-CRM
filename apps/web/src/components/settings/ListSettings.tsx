'use client';
import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, ErrorBox, Spinner, useConfirm, useToast } from '@/components/ui';
import { del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { Section } from './shared';

interface LeadOption {
  kind: 'source' | 'industry';
  label: string;
  lead_count: number;
}
interface Labelled {
  id: string;
  label: string;
  usage_count: number;
}

function AddRow({ placeholder, onAdd, disabled }: { placeholder: string; onAdd: (label: string) => Promise<void>; disabled?: boolean }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onAdd(value.trim());
      setValue('');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
      <input
        aria-label={placeholder}
        className="input"
        placeholder={placeholder}
        value={value}
        maxLength={60}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" variant="soft" loading={saving} disabled={disabled || !value.trim()}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    </form>
  );
}

/* Lead source & industry options. Any staff member can add; admins can delete unused ones. */
export function LeadOptionSettings() {
  const toast = useToast();
  const { isAdmin } = useSession();
  const options = useLoad((s) => get<LeadOption[]>('/lead-options', s), []);

  const add = async (kind: LeadOption['kind'], label: string) => {
    try {
      await post('/lead-options', { kind, label });
      await options.reload();
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (o: LeadOption) => {
    try {
      await del(`/lead-options/${o.kind}/${encodeURIComponent(o.label)}`);
      options.setData((l) => l?.filter((x) => !(x.kind === o.kind && x.label === o.label)));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Section title="Lead sources and industries" description="Choices offered on lead forms and filters. Options in use cannot be deleted.">
      {options.error ? (
        <ErrorBox error={options.error} retry={options.reload} />
      ) : !options.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(['source', 'industry'] as const).map((kind) => (
            <Card key={kind} title={kind === 'source' ? 'Sources' : 'Industries'} bodyClassName="p-0">
              <ul className="flex flex-wrap gap-2 p-4">
                {options
                  .data!.filter((o) => o.kind === kind)
                  .map((o) => (
                    <li key={o.label} className="inline-flex items-center gap-1 rounded-full border border-line py-0.5 pr-1 pl-3 text-sm">
                      {o.label}
                      <span className="text-xs text-faint">{o.lead_count}</span>
                      {isAdmin && (
                        <button
                          type="button"
                          className="rounded-full p-0.5 text-mute hover:bg-subtle hover:text-danger disabled:opacity-30"
                          aria-label={`Delete ${o.label}`}
                          disabled={o.lead_count > 0}
                          title={o.lead_count > 0 ? 'In use by leads' : 'Delete'}
                          onClick={() => remove(o)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
              <AddRow placeholder={`New ${kind}`} onAdd={(l) => add(kind, l)} />
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

/* File types and reminder types share one editable-list UI. */
export function LabelledListSettings({
  path,
  title,
  description,
  noun,
}: {
  path: string;
  title: string;
  description: string;
  noun: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useSession();
  const list = useLoad((s) => get<Labelled[]>(path, s), [path]);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

  const add = async (label: string) => {
    try {
      const row = await post<Labelled>(path, { label });
      list.setData((l) => [...(l ?? []), row]);
    } catch (e) {
      toast.error(e);
    }
  };
  const rename = async () => {
    if (!editing?.label.trim()) return;
    try {
      const row = await patch<Labelled>(`${path}/${editing.id}`, { label: editing.label.trim() });
      list.setData((l) => l?.map((x) => (x.id === row.id ? { ...x, label: row.label } : x)));
      setEditing(null);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (t: Labelled) => {
    if (!(await confirm({ title: `Delete “${t.label}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`${path}/${t.id}`);
      list.setData((l) => l?.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Section title={title} description={description}>
      <Card bodyClassName="p-0">
        {list.error ? (
          <div className="p-4">
            <ErrorBox error={list.error} retry={list.reload} />
          </div>
        ) : !list.data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                {editing?.id === t.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <input
                      aria-label={`Rename ${t.label}`}
                      className="input"
                      autoFocus
                      value={editing.label}
                      maxLength={60}
                      onChange={(e) => setEditing({ id: t.id, label: e.target.value })}
                    />
                    <Button size="icon" type="submit" variant="soft" aria-label="Save">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{t.label}</span>
                    {t.usage_count > 0 && <Badge>{t.usage_count} in use</Badge>}
                    {isAdmin && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Rename ${t.label}`}
                          onClick={() => setEditing({ id: t.id, label: t.label })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${t.label}`}
                          disabled={t.usage_count > 0 || list.data!.length <= 1}
                          onClick={() => remove(t)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && <AddRow placeholder={`New ${noun}`} onAdd={add} />}
      </Card>
    </Section>
  );
}
