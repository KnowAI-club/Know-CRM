'use client';
import { useRef, useState, type FormEvent } from 'react';
import { Download, Eye, FileUp, Lock, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import { api, del, get, patch } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { bytes, relative } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, Menu, Modal, useConfirm, useToast } from '@/components/ui';
import type { FileType, ProjectFile, Visibility } from './types';
import { fieldErrors } from './util';

export function useFileTypes() {
  return useLoad((s) => get<FileType[]>('/file-types', s), []);
}

export function FilesTab({ projectId, files, onChange }: { projectId: string; files: ProjectFile[]; onChange: (f: ProjectFile[]) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: types } = useFileTypes();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [form, setForm] = useState({ name: '', fileTypeId: '', visibility: 'internal' as Visibility });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string; fileTypeId: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [dragging, setDragging] = useState(false);

  const choose = (f: File | undefined | null) => {
    if (!f) return;
    setPicked(f);
    setErrors({});
    setForm((x) => ({ ...x, name: f.name, fileTypeId: x.fileTypeId || types?.[0]?.id || '' }));
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    if (!form.fileTypeId) return setErrors({ fileTypeId: 'Choose a file type.' });
    const fd = new FormData();
    fd.append('fileTypeId', form.fileTypeId);
    fd.append('visibility', form.visibility);
    fd.append('name', form.name);
    fd.append('file', picked);
    setUploading(true);
    try {
      const f = await api<ProjectFile>(`/projects/${projectId}/files`, { method: 'POST', body: fd });
      const label = types?.find((t) => t.id === f.file_type_id)?.label ?? null;
      onChange([{ ...f, file_type_label: label }, ...files]);
      setPicked(null);
      if (input.current) input.current.value = '';
      toast.success('File uploaded');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  const update = async (f: ProjectFile, body: Record<string, unknown>) => {
    try {
      const u = await patch<ProjectFile>(`/files/${f.id}`, body);
      const label = types?.find((t) => t.id === u.file_type_id)?.label ?? f.file_type_label;
      onChange(files.map((x) => (x.id === f.id ? { ...x, ...u, file_type_label: label } : x)));
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };

  const remove = async (f: ProjectFile) => {
    if (!(await confirm({ title: `Delete ${f.name}?`, description: 'The file is removed from storage. This cannot be undone.', confirmLabel: 'Delete', danger: true })))
      return;
    try {
      await del(`/files/${f.id}`);
      onChange(files.filter((x) => x.id !== f.id));
    } catch (e) {
      toast.error(e);
    }
  };

  const shown = files.filter((f) => !typeFilter || f.file_type_id === typeFilter);

  return (
    <div className="space-y-4">
      <Card title="Upload" icon={<FileUp className="h-4 w-4" />}>
        {!picked ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${dragging ? 'border-acc bg-acc-soft/40' : 'border-line'}`}
          >
            <p className="text-sm">Drop a file here, or</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => input.current?.click()}>
              Choose file
            </Button>
            <p className="mt-2 text-xs text-faint">Stored on your own server. Internal by default.</p>
          </div>
        ) : (
          <form onSubmit={upload} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]" noValidate>
            <Field label={`Name (${bytes(picked.size)})`} error={errors.name}>
              <input className="input" value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="File type" required error={errors.fileTypeId}>
              <select className="input" value={form.fileTypeId} onChange={(e) => setForm({ ...form, fileTypeId: e.target.value })}>
                <option value="">Choose…</option>
                {types?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visibility">
              <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}>
                <option value="internal">Internal</option>
                <option value="client">Shared with client</option>
              </select>
            </Field>
            <div className="flex gap-2 self-end">
              <Button variant="ghost" onClick={() => setPicked(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={uploading}>
                Upload
              </Button>
            </div>
          </form>
        )}
        <input ref={input} type="file" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      </Card>

      <Card
        title={`Files (${files.length})`}
        bodyClassName="p-0"
        action={
          <select className="input h-8 w-auto py-0 text-xs" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {types?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        }
      >
        {!shown.length ? (
          <Empty title="No files" description="Upload briefs, designs, contracts and deliverables." />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <a href={`/api/files/${f.id}/download`} className="block truncate text-sm font-medium hover:underline">
                    {f.name}
                  </a>
                  <p className="text-xs text-faint">
                    {f.file_type_label ?? 'Unfiled'} · {bytes(Number(f.size))} · {relative(f.created_at)}
                  </p>
                </div>
                {f.to_share && <Badge tone="violet">To share</Badge>}
                {f.visibility === 'client' ? (
                  <Badge tone="info">
                    <Eye className="h-3 w-3" /> Shared
                  </Badge>
                ) : (
                  <Badge>
                    <Lock className="h-3 w-3" /> Internal
                  </Badge>
                )}
                <a href={`/api/files/${f.id}/download`} className="rounded-md p-1.5 text-mute hover:bg-subtle hover:text-ink" aria-label={`Download ${f.name}`}>
                  <Download className="h-4 w-4" />
                </a>
                <Menu
                  trigger={(open) => (
                    <Button size="icon" variant="ghost" onClick={open} aria-label="File actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  )}
                  items={[
                    {
                      label: f.visibility === 'client' ? 'Make internal' : 'Share with client',
                      icon: f.visibility === 'client' ? <Lock className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
                      onSelect: () => void update(f, { visibility: f.visibility === 'client' ? 'internal' : 'client' }),
                    },
                    {
                      label: f.to_share ? 'Unmark “to share”' : 'Mark “to share”',
                      icon: <Share2 className="h-4 w-4" />,
                      onSelect: () => void update(f, { toShare: !f.to_share }),
                    },
                    { label: 'Rename / refile', icon: <Pencil className="h-4 w-4" />, onSelect: () => setRename({ id: f.id, name: f.name, fileTypeId: f.file_type_id ?? '' }) },
                    { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void remove(f) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!rename}
        onClose={() => setRename(null)}
        title="Rename file"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const f = files.find((x) => x.id === rename?.id);
                if (f && rename && (await update(f, { name: rename.name, ...(rename.fileTypeId ? { fileTypeId: rename.fileTypeId } : {}) }))) setRename(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {rename && (
          <div className="space-y-3">
            <Field label="Name" hint="The original extension is kept.">
              <input className="input" value={rename.name} maxLength={200} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
            </Field>
            <Field label="File type">
              <select className="input" value={rename.fileTypeId} onChange={(e) => setRename({ ...rename, fileTypeId: e.target.value })}>
                {types?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
