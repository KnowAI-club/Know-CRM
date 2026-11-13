'use client';
import { useRef, useState } from 'react';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { api, del } from '@/lib/api';
import { bytes, relative } from '@/lib/format';
import { Button, Card, useConfirm, useToast } from '@/components/ui';

export interface MeetingFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  created_at: string;
}

/** Files attached to a meeting (team only). */
export function MeetingFiles({ meetingId, files, onChange }: { meetingId: string; files: MeetingFile[]; onChange: (f: MeetingFile[]) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    const added: MeetingFile[] = [];
    try {
      for (const file of Array.from(list)) {
        const body = new FormData();
        body.append('file', file);
        added.push(await api<MeetingFile>(`/meetings/${meetingId}/files`, { method: 'POST', body }));
      }
      toast.success(added.length === 1 ? 'File uploaded' : `${added.length} files uploaded`);
    } catch (e) {
      toast.error(e);
    } finally {
      if (added.length) onChange([...files, ...added]);
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (f: MeetingFile) => {
    if (!(await confirm({ title: 'Delete this file?', description: f.name, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/meetings/${meetingId}/files/${f.id}`);
      onChange(files.filter((x) => x.id !== f.id));
      toast.success('File deleted');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Card
      title="Files"
      icon={<Paperclip className="h-4 w-4" />}
      action={
        <>
          <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => input.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
        </>
      }
      bodyClassName="px-4 py-1"
    >
      {files.length === 0 ? (
        <p className="py-3 text-sm text-mute">No files yet. Attach slides, notes or recordings.</p>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{f.name}</p>
                <p className="text-xs text-mute">
                  {bytes(Number(f.size))} · {relative(f.created_at)}
                </p>
              </div>
              <a href={`/api/meetings/${meetingId}/files/${f.id}/download`} className="rounded-md p-1.5 text-mute hover:bg-subtle hover:text-ink" aria-label={`Download ${f.name}`}>
                <Download className="h-4 w-4" />
              </a>
              <Button variant="ghost" size="icon" aria-label={`Delete ${f.name}`} onClick={() => remove(f)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
