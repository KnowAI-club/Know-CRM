'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MessagesSquare, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Avatar, Button, Empty, ErrorBox, PageHeader, Segmented, Skeleton, Spinner } from '@/components/ui';
import { MessageThread } from '@/components/projects/MessageThread';
import type { Message } from '@/components/projects/types';

interface Conversation {
  project_id: string;
  project_name: string;
  contact_name: string;
  stage_category: string;
  last_body: string | null;
  last_author: string | null;
  last_at: string | null;
  message_count: number;
}

function Thread({ projectId, onSent }: { projectId: string; onSent: (m: Message[]) => void }) {
  const { data, error, loading, reload, setData } = useLoad((s) => get<Message[]>(`/projects/${projectId}/messages`, s), [projectId]);
  if (error) return <div className="p-4"><ErrorBox error={error} retry={reload} /></div>;
  if (loading && !data) return <Spinner />;
  return (
    <MessageThread
      projectId={projectId}
      messages={data ?? []}
      side="team"
      emptyText="No messages yet. Write the first one; the client sees it in their portal."
      onChange={(m) => {
        setData(m);
        onSent(m);
      }}
    />
  );
}

function Inbox() {
  const { isAdmin } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = params.get('project');
  const { data, error, loading, reload, setData } = useLoad((s) => (isAdmin ? get<Conversation[]>('/messages', s) : Promise.resolve([])), [isAdmin]);
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter(
      (c) => (scope === 'all' || c.message_count > 0) && (!term || [c.project_name, c.contact_name].some((s) => s.toLowerCase().includes(term))),
    );
  }, [data, scope, q]);

  if (!isAdmin) return <Empty title="Admins only" description="Client messages are handled by workspace admins." />;

  const current = data?.find((c) => c.project_id === selected);
  const select = (id: string | null) => router.replace(id ? `${pathname}?project=${id}` : pathname, { scroll: false });

  return (
    <div>
      <PageHeader eyebrow="Delivery" title="Client messages" description="Conversations with clients from their portal, one thread per project." />
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="card grid min-h-[60vh] overflow-hidden md:grid-cols-[20rem_1fr]">
          <aside className={cn('border-line md:border-r', selected && 'hidden md:block')}>
            <div className="space-y-2 border-b border-line p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className="input pl-9" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
              </div>
              <Segmented
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'active', label: 'With messages' },
                  { value: 'all', label: 'All projects' },
                ]}
              />
            </div>
            {!list.length ? (
              <Empty title="No conversations" description={scope === 'active' ? 'Switch to “All projects” to start one.' : undefined} />
            ) : (
              <ul className="max-h-[65vh] divide-y divide-line overflow-y-auto">
                {list.map((c) => (
                  <li key={c.project_id}>
                    <button
                      onClick={() => select(c.project_id)}
                      className={cn('flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-subtle', c.project_id === selected && 'bg-acc-soft')}
                    >
                      <Avatar name={c.contact_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="truncate text-sm font-medium">{c.project_name}</p>
                          {c.last_at && <span className="ml-auto shrink-0 text-[11px] text-faint">{relative(c.last_at)}</span>}
                        </div>
                        <p className="truncate text-xs text-mute">
                          {c.last_body ? `${c.last_author}: ${c.last_body}` : c.contact_name}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <section className={cn('flex flex-col', !selected && 'hidden md:flex')}>
            {selected && current ? (
              <>
                <header className="flex items-center gap-2 border-b border-line px-4 py-3">
                  <Button size="icon" variant="ghost" className="md:hidden" onClick={() => select(null)} aria-label="Back to conversations">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{current.project_name}</p>
                    <p className="truncate text-xs text-mute">{current.contact_name}</p>
                  </div>
                  <Link href={`/projects/${current.project_id}`} className="text-xs text-acc hover:underline">
                    Open project
                  </Link>
                </header>
                <Thread
                  key={current.project_id}
                  projectId={current.project_id}
                  onSent={(m) => {
                    const last = m[m.length - 1];
                    if (!last) return;
                    setData((list) =>
                      list?.map((c) =>
                        c.project_id === current.project_id
                          ? { ...c, last_body: last.body, last_author: last.author_name, last_at: last.created_at, message_count: m.length }
                          : c,
                      ),
                    );
                  }}
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <Empty icon={<MessagesSquare className="h-5 w-5" />} title="Choose a conversation" />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inbox />
    </Suspense>
  );
}
