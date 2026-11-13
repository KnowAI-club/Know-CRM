'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, Stat } from '@/components/ui';
import { PlanStrip } from '@/components/nurtures/PlanStrip';
import { nextLabel } from '@/components/nurtures/actions';
import type { Sequence, Tracked } from '@/components/nurtures/types';

const SENDER: Record<string, string> = { owner: 'Lead owner', team: 'Workspace', person: '' };

export default function SequencePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad((s) => get<Sequence & { leads: Tracked[] }>(`/nurtures/sequences/${id}`, s), [id]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Spinner />;
  const s = data;
  return (
    <>
      <PageHeader
        back={{ href: '/nurtures', label: 'Nurtures' }}
        eyebrow="Nurture sequence"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.name} {s.status === 'draft' ? <Badge tone="warn">Draft</Badge> : <Badge tone="ok">Active</Badge>}
          </span>
        }
        description={s.description}
        actions={
          <Link href={`/nurtures/sequences/${s.id}/edit`}>
            <Button variant="secondary">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leads in sequence" value={s.stats.leads} />
        <Stat label="Due now" value={s.stats.due} tone={s.stats.due ? 'warn' : undefined} />
        <Stat label="Emails sent" value={s.stats.sent} />
        <Stat label="Reply rate" value={`${s.stats.replyRate}%`} hint={`${s.stats.replied} replied`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Emails" bodyClassName="p-0">
          <ol className="divide-y divide-line">
            {s.emails.map((e, i) => {
              const st = s.stats.perEmail[e.id] ?? { sent: 0, replied: 0, due: 0 };
              return (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-acc-soft text-xs font-semibold text-acc">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.subject || '(no subject)'}</p>
                    <p className="text-xs text-mute">
                      Day {e.day} at {e.send_time} · {SENDER[e.sender] || e.sender_name}
                    </p>
                    {e.note && <p className="mt-1 text-xs text-faint italic">{e.note}</p>}
                  </div>
                  <div className="shrink-0 text-right text-xs text-mute">
                    <p>{st.sent} sent</p>
                    <p>{st.replied} replied</p>
                    {st.due > 0 && <p className="font-medium text-warn">{st.due} due</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
            {s.stop_on_reply ? 'Stops when a lead replies.' : 'Keeps going after a reply.'} {s.weekly_cap ? 'At most one email a week.' : ''}
          </p>
        </Card>
        <Card title="Leads" bodyClassName="p-0">
          {data.leads.length === 0 ? (
            <Empty title="No one in this sequence" description="Add leads from the General list in Nurtures." />
          ) : (
            <ul className="divide-y divide-line">
              {data.leads.map((t) => (
                <li key={t.id}>
                  <Link href={`/nurtures/leads/${t.lead_id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="truncate text-xs text-mute">{nextLabel(t)}</p>
                    </div>
                    <PlanStrip plan={t.plan} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
