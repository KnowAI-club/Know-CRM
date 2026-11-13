'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Download, ExternalLink, FileText, Receipt } from 'lucide-react';
import { get, patch } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { bytes, date, dateTime, money, relative, titleCase } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Card, Empty, ErrorBox, PageHeader, Skeleton, Spinner, Tabs, useToast } from '@/components/ui';
import { MessageThread } from '@/components/projects/MessageThread';
import { StageDot } from '@/components/projects/StageDot';
import type {
  Activity,
  DocumentRow,
  InvoiceView,
  MeetingRow,
  Message,
  Milestone,
  Note,
  ProjectFile,
  Task,
} from '@/components/projects/types';
import { DOC_KIND_LABEL, INVOICE_TONE } from '@/components/projects/util';

interface PortalDetail {
  project: {
    id: string;
    name: string;
    stage_label: string;
    stage_color: string;
    stage_category: string;
    progress: number;
    due_date: string | null;
  };
  tasks: Task[];
  notes: Note[];
  files: ProjectFile[];
  milestones: Milestone[];
  meetings: MeetingRow[];
  documents: DocumentRow[];
  messages: Message[];
  invoices: InvoiceView[];
  activity?: Activity[];
}

type Tab = 'overview' | 'documents' | 'invoices' | 'files' | 'messages';

function Overview({ d, onTasks }: { d: PortalDetail; onTasks: (t: Task[]) => void }) {
  const { user } = useSession();
  const toast = useToast();
  const done = d.milestones.filter((m) => m.status === 'done').length;
  const mine = d.tasks.filter((t) => t.assignee_id === user?.id);
  const [now] = useState(() => Date.now());
  const upcoming = d.meetings.filter((m) => new Date(m.start_at).getTime() >= now).reverse();

  const toggle = async (t: Task) => {
    try {
      const u = await patch<Task>(`/tasks/${t.id}`, { completed: !t.completed });
      onTasks(d.tasks.map((x) => (x.id === t.id ? { ...x, ...u } : x)));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Progress">
          {!d.milestones.length ? (
            <p className="text-sm text-mute">The team will share the delivery plan here soon.</p>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-acc" style={{ width: `${(done / d.milestones.length) * 100}%` }} />
                </div>
                <span className="text-xs text-mute tabular-nums">
                  {done} of {d.milestones.length} stages done
                </span>
              </div>
              <ol className="relative space-y-4 border-l border-line pl-6">
                {d.milestones.map((m) => (
                  <li key={m.id} className="relative">
                    <span
                      className={cn(
                        'absolute top-0.5 -left-[33px] grid h-4 w-4 place-items-center rounded-full border-2 bg-card',
                        m.status === 'done' ? 'border-acc bg-acc text-acc-ink' : m.status === 'in_progress' ? 'border-acc' : 'border-line',
                      )}
                    >
                      {m.status === 'done' && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className={cn('text-sm font-medium', m.status === 'upcoming' && 'text-mute')}>{m.title}</p>
                      {m.status === 'in_progress' && <Badge tone="acc">In progress</Badge>}
                      {m.due_date && <span className="text-xs text-faint">{date(m.due_date)}</span>}
                    </div>
                    {m.description && <p className="mt-0.5 text-xs text-mute">{m.description}</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </Card>
        <Card title="Updates from the team">
          {!d.notes.length ? (
            <p className="text-sm text-mute">No updates yet.</p>
          ) : (
            <ul className="space-y-4">
              {d.notes.map((n) => (
                <li key={n.id}>
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-faint">
                    {n.author_name} · {relative(n.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {d.activity && d.activity.length > 0 && (
          <Card title="Timeline">
            <ul className="space-y-3">
              {d.activity.slice(0, 20).map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="w-24 shrink-0 text-xs text-faint">{date(a.created_at, { year: undefined })}</span>
                  <span>{a.description}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        {mine.length > 0 && (
          <Card title="Your to-dos">
            <ul className="space-y-2">
              {mine.map((t) => (
                <li key={t.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={t.completed}
                    onChange={() => toggle(t)}
                    aria-label={`Complete ${t.title}`}
                  />
                  <div>
                    <p className={cn('text-sm', t.completed && 'text-mute line-through')}>{t.title}</p>
                    {t.due_date && <p className="text-xs text-faint">Due {date(t.due_date)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Meetings">
          {!d.meetings.length ? (
            <p className="text-sm text-mute">No meetings shared yet.</p>
          ) : (
            <ul className="space-y-3">
              {(upcoming.length ? upcoming : d.meetings.slice(0, 3)).map((m) => (
                <li key={m.id} className="text-sm">
                  <p className="font-medium">{m.title}</p>
                  <p className="text-xs text-mute">
                    {dateTime(m.start_at)} · {m.duration_minutes} min · {titleCase(m.kind)}
                  </p>
                  {m.meeting_url && new Date(m.start_at).getTime() >= now && (
                    <a
                      href={m.meeting_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-acc hover:underline"
                    >
                      Join link <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {m.location && <p className="text-xs text-faint">{m.location}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function PortalProject() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data, error, loading, reload, setData } = useLoad((s) => get<PortalDetail>(`/portal/projects/${id}`, s), [id]);
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => router.replace(`${pathname}${t === 'overview' ? '' : `?tab=${t}`}`, { scroll: false });

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Skeleton className="h-96 w-full" />;
  if (!data) return <Spinner />;
  const d = data;
  const due = d.invoices.filter((i) => i.status !== 'void').reduce((a, i) => a + i.balance, 0);
  const currency = d.invoices[0]?.currency;
  const pendingDocs = d.documents.length;

  return (
    <div>
      <PageHeader
        back={{ href: '/portal', label: 'Your projects' }}
        title={d.project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StageDot color={d.project.stage_color} label={d.project.stage_label} />
            {d.project.due_date && <span>Target {date(d.project.due_date)}</span>}
            {due > 0 && currency && <span className="font-medium text-warn">{money(due, currency)} outstanding</span>}
          </span>
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'documents', label: 'Documents', count: pendingDocs },
          { value: 'invoices', label: 'Invoices', count: d.invoices.length },
          { value: 'files', label: 'Files', count: d.files.length },
          { value: 'messages', label: 'Messages', count: d.messages.length },
        ]}
      />
      {tab === 'overview' && <Overview d={d} onTasks={(t) => setData({ ...d, tasks: t })} />}
      {tab === 'documents' && (
        <Card bodyClassName="p-0">
          {!d.documents.length ? (
            <Empty
              icon={<FileText className="h-5 w-5" />}
              title="No documents"
              description="Proposals, contracts and questionnaires from the team appear here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {d.documents.map((doc) => (
                <li key={doc.id}>
                  <Link href={`/portal/documents/${doc.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-mute">
                        {DOC_KIND_LABEL[doc.kind]} · shared {relative(doc.published_at)}
                      </p>
                    </div>
                    <span className="text-xs text-acc">
                      {doc.kind === 'contract' ? 'Review & sign' : doc.kind === 'questionnaire' ? 'Answer' : 'Review'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'invoices' && (
        <Card bodyClassName="p-0">
          {!d.invoices.length ? (
            <Empty icon={<Receipt className="h-5 w-5" />} title="No invoices" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Status</th>
                    <th>Next due</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {d.invoices.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/portal/invoices/${i.id}`} className="font-medium hover:underline">
                          {i.number}
                        </Link>
                        <p className="text-xs text-mute">{i.title}</p>
                      </td>
                      <td>
                        <Badge tone={INVOICE_TONE[i.status] ?? 'neutral'}>{titleCase(i.status)}</Badge>
                      </td>
                      <td className="text-mute">{i.balance > 0 ? date(i.next_payment_due || i.due_date) : '—'}</td>
                      <td className="text-right tabular-nums">{money(i.total, i.currency)}</td>
                      <td className="text-right font-medium tabular-nums">{money(i.balance, i.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === 'files' && (
        <Card bodyClassName="p-0">
          {!d.files.length ? (
            <Empty title="No shared files" />
          ) : (
            <ul className="divide-y divide-line">
              {d.files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.name}</p>
                    <p className="text-xs text-faint">
                      {f.file_type_label ?? 'File'} · {bytes(Number(f.size))} · {relative(f.created_at)}
                    </p>
                  </div>
                  <a
                    href={`/api/files/${f.id}/download`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-acc hover:bg-acc-soft"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'messages' && (
        <div className="card">
          <MessageThread
            projectId={d.project.id}
            messages={d.messages}
            onChange={(m) => setData({ ...d, messages: m })}
            side="client"
            emptyText="Ask a question or share feedback. The team will reply here."
          />
        </div>
      )}
    </div>
  );
}

export default function PortalProjectPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PortalProject />
    </Suspense>
  );
}
