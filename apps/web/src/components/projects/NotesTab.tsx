'use client';
import { useState } from 'react';
import { Eye, Lock, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { del, patch, post } from '@/lib/api';
import { relative } from '@/lib/format';
import { Avatar, Badge, Button, Card, Empty, MentionText, MentionTextarea, Segmented, useConfirm, useToast } from '@/components/ui';
import type { Note, Visibility } from './types';

const hasMention = (s: string) => /@\[[^\]]+\]\(user:/.test(s);

export function NotesTab({ projectId, notes, onChange }: { projectId: string; notes: Note[]; onChange: (n: Note[]) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<Visibility>('internal');
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<{ id: string; body: string; visibility: Visibility } | null>(null);
  const [filter, setFilter] = useState<'all' | Visibility>('all');

  const add = async () => {
    if (!body.trim()) return;
    if (vis === 'client' && hasMention(body)) return toast.error('Remove @mentions before sharing this note with the client.');
    setSaving(true);
    try {
      const n = await post<Note>(`/projects/${projectId}/notes`, { body, visibility: vis });
      onChange([n, ...notes]);
      setBody('');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!edit || !edit.body.trim()) return;
    setSaving(true);
    try {
      const n = await patch<Note>(`/notes/${edit.id}`, { body: edit.body, visibility: edit.visibility });
      onChange(notes.map((x) => (x.id === n.id ? n : x)));
      setEdit(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: Note) => {
    if (!(await confirm({ title: 'Delete note?', description: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/notes/${n.id}`);
      onChange(notes.filter((x) => x.id !== n.id));
    } catch (e) {
      toast.error(e);
    }
  };

  const shown = notes.filter((n) => filter === 'all' || n.visibility === filter);

  return (
    <div className="space-y-4">
      <Card title="New note" icon={<StickyNote className="h-4 w-4" />}>
        <MentionTextarea value={body} onChange={setBody} onSubmit={add} placeholder="Write a note. Type @ to mention a teammate (internal notes only)." />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented
            value={vis}
            onChange={setVis}
            options={[
              { value: 'internal', label: 'Internal', icon: <Lock className="h-3 w-3" /> },
              { value: 'client', label: 'Share with client', icon: <Eye className="h-3 w-3" /> },
            ]}
          />
          <span className="text-xs text-faint">{vis === 'client' ? 'Visible in the client portal.' : 'Only your team can see this.'}</span>
          <Button className="ml-auto" onClick={add} loading={saving && !edit} disabled={!body.trim()}>
            Add note
          </Button>
        </div>
      </Card>
      <div className="flex justify-end">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${notes.length})` },
            { value: 'internal', label: 'Internal' },
            { value: 'client', label: 'Shared' },
          ]}
        />
      </div>
      {!shown.length ? (
        <div className="card">
          <Empty title="No notes" description="Capture decisions, context and updates here." />
        </div>
      ) : (
        shown.map((n) => (
          <article key={n.id} className="card p-4">
            <header className="mb-2 flex items-center gap-2">
              <Avatar name={n.author_name} size="sm" />
              <span className="text-sm font-medium">{n.author_name}</span>
              <span className="text-xs text-faint" title={new Date(n.created_at).toLocaleString()}>
                {relative(n.created_at)}
                {n.updated_at !== n.created_at && ' · edited'}
              </span>
              <span className="ml-auto">
                {n.visibility === 'client' ? (
                  <Badge tone="info">
                    <Eye className="h-3 w-3" /> Shared
                  </Badge>
                ) : (
                  <Badge>
                    <Lock className="h-3 w-3" /> Internal
                  </Badge>
                )}
              </span>
              <Button size="icon" variant="ghost" aria-label="Edit note" onClick={() => setEdit({ id: n.id, body: n.body, visibility: n.visibility })}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Delete note" onClick={() => remove(n)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </header>
            {edit?.id === n.id ? (
              <div>
                <MentionTextarea value={edit.body} onChange={(b) => setEdit({ ...edit, body: b })} onSubmit={save} rows={4} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Segmented
                    value={edit.visibility}
                    onChange={(v) => setEdit({ ...edit, visibility: v })}
                    options={[
                      { value: 'internal', label: 'Internal' },
                      { value: 'client', label: 'Shared' },
                    ]}
                  />
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} loading={saving}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <MentionText text={n.body} className="text-sm leading-relaxed" />
            )}
          </article>
        ))
      )}
    </div>
  );
}
