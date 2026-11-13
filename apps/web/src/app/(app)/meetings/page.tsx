'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, FileUp, Plus, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton, Tabs } from '@/components/ui';
import { MeetingModal, UploadMeetingModal, meetingEnd, type Meeting } from '@/components/work/meetings';
import { MeetingItem } from '@/components/work/MeetingItem';
import { useNow } from '@/components/work/useNow';

type View = 'upcoming' | 'outcome' | 'past' | 'cancelled';

function dayLabel(d: Date) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === start.getFullYear() ? undefined : 'numeric',
  });
}

export default function MeetingsPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useLoad((s) => get<Meeting[]>('/meetings', s));
  const [view, setView] = useState<View>('upcoming');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const now = useNow();

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = (data ?? []).filter(
      (m) =>
        (scope === 'all' || m.mine) &&
        (!term || [m.title, m.lead_name, m.project_name, m.organizer_name].some((v) => v?.toLowerCase().includes(term))),
    );
    const live = base.filter((m) => m.status !== 'cancelled');
    return {
      upcoming: live
        .filter((m) => meetingEnd(m).getTime() >= now && m.source !== 'upload')
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
      outcome: live.filter((m) => meetingEnd(m).getTime() < now && m.source !== 'upload' && !m.outcome),
      past: live.filter((m) => meetingEnd(m).getTime() < now || m.source === 'upload'),
      cancelled: base.filter((m) => m.status === 'cancelled'),
    };
  }, [data, scope, q, now]);

  const list = groups[view];
  const byDay = useMemo(() => {
    const out: { label: string; items: Meeting[] }[] = [];
    for (const m of list) {
      const label = dayLabel(new Date(m.start_at));
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [list]);

  return (
    <>
      <PageHeader
        eyebrow="Follow-ups"
        title="Meetings"
        description="Calls and meetings with leads and clients, with outcomes and next steps."
        actions={
          <>
            <Button variant="secondary" onClick={() => setUploading(true)}>
              <FileUp className="h-4 w-4" /> Add past meeting
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Schedule
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
            { value: 'outcome', label: 'Needs outcome', count: groups.outcome.length },
            { value: 'past', label: 'Past', count: groups.past.length },
            { value: 'cancelled', label: 'Cancelled', count: groups.cancelled.length },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              className="input pl-8"
              placeholder="Search meetings"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search meetings"
            />
          </div>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'mine', label: 'Mine' },
              { value: 'all', label: 'Everyone' },
            ]}
          />
        </div>
      </div>
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Card>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : byDay.length === 0 ? (
        <Card>
          <Empty
            icon={<CalendarDays className="h-5 w-5" />}
            title={view === 'outcome' ? 'All outcomes recorded' : view === 'upcoming' ? 'No upcoming meetings' : 'No meetings here'}
            description={view === 'upcoming' ? 'Schedule a call with a lead or a project client.' : undefined}
            action={
              view === 'upcoming' ? (
                <Button variant="soft" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Schedule
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {byDay.map((g) => (
            <section key={g.label}>
              <p className="eyebrow mb-1.5 px-1">{g.label}</p>
              <div className="card divide-y divide-line p-1.5">
                {g.items.map((m) => (
                  <MeetingItem key={m.id} m={m} needsOutcome={view === 'outcome'} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <MeetingModal open={creating} onClose={() => setCreating(false)} onSaved={(m) => router.push(`/meetings/${m.id}`)} />
      <UploadMeetingModal open={uploading} onClose={() => setUploading(false)} onSaved={(m) => router.push(`/meetings/${m.id}`)} />
    </>
  );
}
