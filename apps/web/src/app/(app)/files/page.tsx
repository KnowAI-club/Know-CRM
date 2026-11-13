'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Eye, FolderOpen, Lock, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { bytes, relative } from '@/lib/format';
import { Badge, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton } from '@/components/ui';
import type { FileType } from '@/components/projects/types';

interface WorkspaceFile {
  id: string;
  source: 'project' | 'lead';
  owner_id: string;
  owner_name: string;
  name: string;
  title: string;
  size: number;
  mime: string;
  visibility: 'internal' | 'client';
  to_share: boolean;
  file_type_id: string | null;
  file_type_label: string | null;
  created_at: string;
  locked: boolean;
}

const PAGE = 100;

export default function FilesPage() {
  const { data, error, loading, reload } = useLoad(
    (s) => Promise.all([get<WorkspaceFile[]>('/files', s), get<FileType[]>('/file-types', s)]).then(([files, types]) => ({ files, types })),
    [],
  );
  const [source, setSource] = useState<'all' | 'project' | 'lead'>('all');
  const [type, setType] = useState('');
  const [share, setShare] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.files ?? []).filter(
      (f) =>
        (source === 'all' || f.source === source) &&
        (!type || f.file_type_id === type) &&
        (!share || (share === 'client' ? f.visibility === 'client' : share === 'to_share' ? f.to_share : f.visibility === 'internal')) &&
        (!term || [f.title, f.name, f.owner_name].some((s) => s?.toLowerCase().includes(term))),
    );
  }, [data, source, type, share, q]);

  const total = rows.reduce((a, f) => a + Number(f.size), 0);
  const href = (f: WorkspaceFile) => (f.source === 'project' ? `/api/files/${f.id}/download` : `/api/lead-attachments/${f.id}/download`);
  const ownerHref = (f: WorkspaceFile) => (f.source === 'project' ? `/projects/${f.owner_id}?tab=files` : `/leads/${f.owner_id}`);

  return (
    <div>
      <PageHeader eyebrow="Delivery" title="Files" description="Every project file and lead attachment, stored on your own server." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search by file, project or lead"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Search files"
          />
        </div>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="File type">
          <option value="">All file types</option>
          {data?.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={share} onChange={(e) => setShare(e.target.value)} aria-label="Sharing">
          <option value="">Any sharing</option>
          <option value="client">Shared with client</option>
          <option value="internal">Internal</option>
          <option value="to_share">Marked to share</option>
        </select>
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All' },
            { value: 'project', label: 'Projects' },
            { value: 'lead', label: 'Leads' },
          ]}
        />
      </div>
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card bodyClassName="p-0" title={`${rows.length} files · ${bytes(total)}`}>
          {!rows.length ? (
            <Empty
              icon={<FolderOpen className="h-5 w-5" />}
              title={data?.files.length ? 'No files match' : 'No files yet'}
              description="Upload files from a project or lead."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Belongs to</th>
                    <th>Type</th>
                    <th>Sharing</th>
                    <th className="text-right">Size</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((f) => (
                    <tr key={`${f.source}-${f.id}`}>
                      <td className="max-w-72">
                        <a href={href(f)} className="block truncate font-medium hover:underline">
                          {f.title}
                        </a>
                        {f.title !== f.name && <p className="truncate text-xs text-faint">{f.name}</p>}
                      </td>
                      <td>
                        <Link href={ownerHref(f)} className="text-mute hover:text-ink hover:underline">
                          {f.owner_name}
                        </Link>
                        <p className="text-xs text-faint">{f.source === 'project' ? 'Project' : f.locked ? 'Lead · won' : 'Lead'}</p>
                      </td>
                      <td className="text-mute">{f.file_type_label ?? '—'}</td>
                      <td>
                        <span className="flex flex-wrap gap-1">
                          {f.visibility === 'client' ? (
                            <Badge tone="info">
                              <Eye className="h-3 w-3" /> Client
                            </Badge>
                          ) : (
                            <Badge>
                              <Lock className="h-3 w-3" /> Internal
                            </Badge>
                          )}
                          {f.to_share && <Badge tone="violet">To share</Badge>}
                        </span>
                      </td>
                      <td className="text-right text-mute tabular-nums">{bytes(Number(f.size))}</td>
                      <td className="whitespace-nowrap text-mute">{relative(f.created_at)}</td>
                      <td className="w-10">
                        <a
                          href={href(f)}
                          className="inline-flex rounded-md p-1.5 text-mute hover:bg-subtle hover:text-ink"
                          aria-label={`Download ${f.title}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > limit && (
                <div className="border-t border-line p-3 text-center">
                  <button className="text-sm text-acc hover:underline" onClick={() => setLimit(limit + PAGE)}>
                    Show more ({rows.length - limit} remaining)
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
