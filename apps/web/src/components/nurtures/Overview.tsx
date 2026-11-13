'use client';
import Link from 'next/link';
import { Mail, Plus } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Badge, Button, Empty, ErrorBox, Skeleton, Stat } from '@/components/ui';
import type { Sequence } from './types';

interface OverviewData {
  stats: { parked: number; inSequence: number; replied: number; backThisMonth: number };
  sequences: Sequence[];
}

export function Overview({ version }: { version: number }) {
  const { data, error, loading, reload } = useLoad((s) => get<OverviewData>('/nurtures/overview', s), [version]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data)
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting in General" value={data.stats.parked} hint="Parked, not in a sequence" />
        <Stat label="In a sequence" value={data.stats.inSequence} />
        <Stat label="Replied" value={data.stats.replied} hint="Ready for a conversation" tone={data.stats.replied ? 'acc' : undefined} />
        <Stat label="Back in pipeline" value={data.stats.backThisMonth} hint="This month" />
      </div>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold">Sequences</h2>
          <Link href="/nurtures/sequences/new">
            <Button size="sm" variant="secondary">
              <Plus className="h-3.5 w-3.5" /> New sequence
            </Button>
          </Link>
        </div>
        {data.sequences.length === 0 ? (
          <div className="card">
            <Empty
              icon={<Mail className="h-5 w-5" />}
              title="No sequences yet"
              description="A sequence is a short series of follow-up emails spaced out over days or weeks."
              action={
                <Link href="/nurtures/sequences/new">
                  <Button>Create a sequence</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.sequences.map((s) => (
              <Link key={s.id} href={`/nurtures/sequences/${s.id}`} className="card block p-5 transition hover:border-acc/50">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate font-semibold">{s.name}</p>
                  {s.status === 'draft' ? <Badge tone="warn">Draft</Badge> : <Badge tone="ok">Active</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm text-mute">{s.description || 'No description'}</p>
                <p className="mt-2 text-xs text-faint">
                  {s.emails.length} emails over {s.last_day ?? 0} days
                </p>
                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
                  {[
                    ['Leads', s.stats.leads],
                    ['Due', s.stats.due],
                    ['Sent', s.stats.sent],
                    ['Reply', `${s.stats.replyRate}%`],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-base font-semibold">{v}</p>
                      <p className="text-[11px] text-mute">{l}</p>
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
