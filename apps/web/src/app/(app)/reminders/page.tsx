'use client';
import { useMemo, useState } from 'react';
import { BellRing, Plus } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { Button, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton, Tabs } from '@/components/ui';
import { ReminderModal, ReminderRow, type Reminder } from '@/components/work/reminders';

type View = 'upcoming' | 'past' | 'all';

export default function RemindersPage() {
  const { user } = useSession();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Reminder[]>('/reminders', s));
  const [view, setView] = useState<View>('upcoming');
  const [who, setWho] = useState<'all' | 'received' | 'sent'>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);

  const scoped = useMemo(
    () =>
      (data ?? []).filter((r) => (who === 'received' ? r.recipient_id === user?.id : who === 'sent' ? r.created_by === user?.id : true)),
    [data, who, user],
  );
  const upcoming = useMemo(
    () => scoped.filter((r) => r.status === 'pending' || r.status === 'failed').sort((a, b) => a.run_at.localeCompare(b.run_at)),
    [scoped],
  );
  const past = useMemo(() => scoped.filter((r) => r.status !== 'pending' && r.status !== 'failed'), [scoped]);
  const list = view === 'upcoming' ? upcoming : view === 'past' ? past : scoped;

  const upsert = (r: Reminder) => setData((rows) => [r, ...(rows ?? []).filter((x) => x.id !== r.id)].sort((a, b) => b.run_at.localeCompare(a.run_at)));

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Reminders"
        description="Scheduled nudges for you and your team about leads, projects and meetings."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New reminder
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
            { value: 'past', label: 'Delivered & cancelled', count: past.length },
            { value: 'all', label: 'All', count: scoped.length },
          ]}
        />
        <Segmented
          value={who}
          onChange={setWho}
          options={[
            { value: 'all', label: 'All' },
            { value: 'received', label: 'For me' },
            { value: 'sent', label: 'Scheduled by me' },
          ]}
        />
      </div>
      <Card bodyClassName="px-4 py-1">
        {error ? (
          <div className="py-3">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : loading && !data ? (
          <div className="space-y-3 py-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <Empty
            icon={<BellRing className="h-5 w-5" />}
            title={view === 'upcoming' ? 'No upcoming reminders' : 'Nothing here yet'}
            description="Schedule a reminder so a follow-up never slips."
            action={
              <Button variant="soft" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New reminder
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {list.map((r) => (
              <ReminderRow key={r.id} reminder={r} onChange={upsert} onEdit={setEditing} />
            ))}
          </div>
        )}
      </Card>
      <ReminderModal open={creating} onClose={() => setCreating(false)} onSaved={upsert} />
      <ReminderModal open={!!editing} reminder={editing} onClose={() => setEditing(null)} onSaved={upsert} />
    </>
  );
}
