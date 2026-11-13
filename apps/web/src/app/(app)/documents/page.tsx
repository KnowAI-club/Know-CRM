'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { relative, titleCase } from '@/lib/format';
import { Badge, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton } from '@/components/ui';
import type { DocumentRow } from '@/components/projects/types';
import { DOC_KIND_LABEL } from '@/components/projects/util';

export default function DocumentsPage() {
  const { data, error, loading, reload } = useLoad((s) => get<DocumentRow[]>('/documents', s), []);
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter(
      (d) =>
        (status === 'all' || d.status === status) &&
        (!kind || d.kind === kind) &&
        (!term || [d.title, d.project_name, d.contact_name].some((s) => s?.toLowerCase().includes(term))),
    );
  }, [data, status, kind, q]);

  const awaiting = (data ?? []).filter((d) => d.status === 'published' && !d.action_count).length;

  return (
    <div>
      <PageHeader
        eyebrow="Delivery"
        title="Documents"
        description="Proposals, contracts and questionnaires shared through the client portal. Create new ones from a project."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search documents" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        </div>
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(DOC_KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Drafts' },
            { value: 'published', label: 'Published' },
          ]}
        />
        {awaiting > 0 && <span className="ml-auto text-xs text-mute">{awaiting} published without a client response</span>}
      </div>
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Card bodyClassName="p-0">
          {!rows.length ? (
            <Empty
              icon={<FileText className="h-5 w-5" />}
              title={data?.length ? 'No documents match' : 'No documents yet'}
              description={data?.length ? 'Try other filters.' : 'Open a project and use the Documents tab to draft one.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Client response</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/documents/${d.id}`} className="font-medium hover:underline">
                          {d.title}
                        </Link>
                        <p className="text-xs text-mute">{DOC_KIND_LABEL[d.kind]}</p>
                      </td>
                      <td>
                        <Link href={`/projects/${d.project_id}?tab=documents`} className="text-mute hover:text-ink hover:underline">
                          {d.project_name}
                        </Link>
                        <p className="text-xs text-faint">{d.contact_name}</p>
                      </td>
                      <td>
                        <Badge tone={d.status === 'published' ? 'ok' : 'neutral'}>{d.status === 'published' ? 'Published' : 'Draft'}</Badge>
                      </td>
                      <td>
                        {d.last_action ? (
                          <Badge tone={d.last_action === 'declined' ? 'danger' : d.last_action === 'answered' ? 'info' : 'ok'}>{titleCase(d.last_action)}</Badge>
                        ) : d.status === 'published' ? (
                          <span className="text-xs text-faint">Awaiting</span>
                        ) : (
                          <span className="text-xs text-faint">—</span>
                        )}
                      </td>
                      <td className="text-mute">{relative(d.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
