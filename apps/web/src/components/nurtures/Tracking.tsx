'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCheck, MessageSquareReply, MoreHorizontal, Pause, Play, Search, Trash2, UserMinus } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { cn } from '@/lib/cn';
import { Button, Empty, ErrorBox, Menu, Segmented, Spinner, useConfirm, useToast } from '@/components/ui';
import { DiscardModal } from './DiscardModal';
import { PlanStrip } from './PlanStrip';
import { assignmentOp, markEmail, nextLabel, replyTarget } from './actions';
import type { SequenceSummary, Tracked } from './types';

type Filter = 'all' | 'due' | 'waiting' | 'replied' | 'paused' | 'completed';
const match = (t: Tracked, f: Filter) =>
  f === 'all' ||
  (f === 'due' && t.next.kind === 'send') ||
  (f === 'waiting' && t.next.kind === 'wait') ||
  (f === 'replied' && t.next.kind === 'reply') ||
  (f === 'paused' && t.next.kind === 'paused') ||
  (f === 'completed' && t.next.kind === 'decide');

export function Tracking({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useLoad((s) => get<{ rows: Tracked[]; sequences: SequenceSummary[] }>('/nurtures/tracking', s), [version]);
  const [filter, setFilter] = useState<Filter>('all');
  const [seq, setSeq] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [discard, setDiscard] = useState<{ id: string; name: string }[]>([]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows ?? [])
      .filter((t) => (!seq || t.sequence_id === seq) && (!term || [t.name, t.email, t.company].some((v) => v?.toLowerCase().includes(term))))
      .sort((a, b) => {
        const rank = (t: Tracked) => ({ send: 0, reply: 1, wait: 2, decide: 3, paused: 4 })[t.next.kind];
        return rank(a) - rank(b) || (('at' in a.next ? a.next.at : '') || '').localeCompare(('at' in b.next ? b.next.at : '') || '');
      });
  }, [data, seq, q]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, due: 0, waiting: 0, replied: 0, paused: 0, completed: 0 };
    for (const t of rows) for (const f of ['due', 'waiting', 'replied', 'paused', 'completed'] as Filter[]) if (match(t, f)) c[f]++;
    return c;
  }, [rows]);

  const run = async (t: Tracked, fn: () => Promise<unknown>, message: string) => {
    setBusy(t.id);
    try {
      await fn();
      toast.success(message);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  const visible = rows.filter((t) => match(t, filter));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={(
            [
              ['all', 'All'],
              ['due', 'Due'],
              ['waiting', 'Waiting'],
              ['replied', 'Replied'],
              ['paused', 'Paused'],
              ['completed', 'Finished'],
            ] as [Filter, string][]
          ).map(([value, label]) => ({ value, label: `${label} ${counts[value]}` }))}
        />
        <span className="flex-1" />
        <select className="input w-auto" value={seq} onChange={(e) => setSeq(e.target.value)} aria-label="Sequence">
          <option value="">All sequences</option>
          {(data?.sequences ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="card">
          <Empty title="Nothing here" description="Leads you add to a sequence appear here with their next email." />
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {visible.map((t) => {
            const next = t.next;
            const reply = replyTarget(t);
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/nurtures/leads/${t.lead_id}`} className="font-medium hover:text-acc">
                    {t.name}
                  </Link>
                  <p className="truncate text-xs text-mute">
                    {[t.company, t.sequence_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="basis-40">
                  <PlanStrip plan={t.plan} />
                  <p className={cn('mt-1 text-xs', next.kind === 'send' ? 'font-medium text-warn' : next.kind === 'reply' ? 'font-medium text-ok' : 'text-mute')}>
                    {nextLabel(t)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {(next.kind === 'send' || next.kind === 'wait') && (
                    <Button
                      size="sm"
                      variant={next.kind === 'send' ? 'primary' : 'secondary'}
                      loading={busy === t.id}
                      onClick={() => run(t, () => markEmail(t.id, next.emailId, { sent: true }), 'Marked sent.')}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Mark sent
                    </Button>
                  )}
                  <Menu
                    trigger={(o) => (
                      <Button variant="ghost" size="icon" onClick={o} aria-label={`Actions for ${t.name}`} disabled={busy === t.id}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    )}
                    items={[
                      ...(reply
                        ? [
                            {
                              label: `Record reply to email ${reply.position + 1}`,
                              icon: <MessageSquareReply className="h-4 w-4" />,
                              onSelect: () => run(t, () => markEmail(t.id, reply.email_id, { replied: true }), 'Reply recorded.'),
                            },
                          ]
                        : []),
                      t.paused_at
                        ? { label: 'Resume', icon: <Play className="h-4 w-4" />, onSelect: () => run(t, () => assignmentOp(t.id, 'resume'), 'Sequence resumed.') }
                        : { label: 'Pause', icon: <Pause className="h-4 w-4" />, onSelect: () => run(t, () => assignmentOp(t.id, 'pause'), 'Sequence paused.') },
                      {
                        label: 'Remove from sequence',
                        icon: <UserMinus className="h-4 w-4" />,
                        onSelect: async () => {
                          if (await confirm({ title: `Remove ${t.name} from ${t.sequence_name}?`, description: 'They return to the General list.', confirmLabel: 'Remove' }))
                            await run(t, () => assignmentOp(t.id, 'remove'), 'Removed from sequence.');
                        },
                      },
                      { label: 'Discard', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDiscard([{ id: t.lead_id, name: t.name }]) },
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DiscardModal
        leads={discard}
        onClose={() => setDiscard([])}
        onDone={() => {
          setDiscard([]);
          void reload();
          onChanged();
        }}
      />
    </>
  );
}
