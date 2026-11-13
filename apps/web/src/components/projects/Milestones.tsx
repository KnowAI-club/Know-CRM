'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { patch, put } from '@/lib/api';
import { date } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, Empty, useToast } from '@/components/ui';
import type { Milestone, MilestoneStatus } from './types';
import { MILESTONE_LABEL, MILESTONE_TONE, fieldErrors } from './util';

interface Draft {
  id?: string;
  key: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  dueDate: string;
}

const toDraft = (m: Milestone): Draft => ({
  id: m.id,
  key: m.id,
  title: m.title,
  description: m.description,
  status: m.status,
  dueDate: m.due_date ?? '',
});

/** Client-visible delivery stages: quick status changes plus a full editor. */
export function Milestones({
  projectId,
  milestones,
  onChange,
}: {
  projectId: string;
  milestones: Milestone[];
  onChange: (m: Milestone[]) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setStatus = async (m: Milestone, status: MilestoneStatus) => {
    setBusy(m.id);
    try {
      onChange(await patch<Milestone[]>(`/projects/${projectId}/milestones/${m.id}`, { status }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!editing) return;
    const missing = editing.findIndex((d) => !d.title.trim());
    if (missing >= 0) return setErrors({ [`milestones.${missing}.title`]: 'Give every stage a name.' });
    setBusy('save');
    try {
      const next = await put<Milestone[]>(`/projects/${projectId}/milestones`, {
        milestones: editing.map((d) => ({ id: d.id, title: d.title, description: d.description, status: d.status, dueDate: d.dueDate || null })),
      });
      onChange(next);
      setEditing(null);
      setErrors({});
      toast.success('Stages saved');
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const update = (i: number, patchDraft: Partial<Draft>) =>
    setEditing((list) => list && list.map((d, j) => (j === i ? { ...d, ...patchDraft } : d)));
  const moveRow = (i: number, dir: -1 | 1) =>
    setEditing((list) => {
      if (!list) return list;
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const done = milestones.filter((m) => m.status === 'done').length;

  return (
    <Card
      title="Delivery stages"
      icon={<Flag className="h-4 w-4" />}
      action={
        editing ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => (setEditing(null), setErrors({}))}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} loading={busy === 'save'}>
              Save stages
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(milestones.map(toDraft))}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          {editing.map((d, i) => (
            <div key={d.key} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-2 w-5 text-xs text-faint tabular-nums">{i + 1}.</span>
                <div className="min-w-48 flex-1">
                  <input
                    className="input"
                    value={d.title}
                    placeholder="Stage name"
                    aria-label={`Stage ${i + 1} name`}
                    maxLength={200}
                    onChange={(e) => update(i, { title: e.target.value })}
                  />
                  {errors[`milestones.${i}.title`] && <p className="mt-1 text-xs text-danger">{errors[`milestones.${i}.title`]}</p>}
                </div>
                <select className="input w-auto" value={d.status} aria-label="Status" onChange={(e) => update(i, { status: e.target.value as MilestoneStatus })}>
                  {Object.entries(MILESTONE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input className="input w-auto" type="date" aria-label="Due date" value={d.dueDate} onChange={(e) => update(i, { dueDate: e.target.value })} />
                <div className="flex">
                  <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveRow(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === editing.length - 1} onClick={() => moveRow(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Remove stage" onClick={() => setEditing(editing.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <textarea
                className="input mt-2"
                rows={2}
                placeholder="What happens in this stage (shown to the client)"
                value={d.description}
                maxLength={2000}
                onChange={(e) => update(i, { description: e.target.value })}
              />
            </div>
          ))}
          {errors.milestones && <p className="text-xs text-danger">{errors.milestones}</p>}
          <Button
            variant="secondary"
            size="sm"
            disabled={editing.length >= 30}
            onClick={() => setEditing([...editing, { key: `new-${Date.now()}`, title: '', description: '', status: 'upcoming', dueDate: '' }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add stage
          </Button>
          <p className="text-xs text-faint">Stages complete in order: marking one done also completes every stage before it.</p>
        </div>
      ) : !milestones.length ? (
        <Empty title="No stages yet" description="Add delivery stages so the client can follow progress in their portal." />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-acc transition-all" style={{ width: `${(done / milestones.length) * 100}%` }} />
            </div>
            <span className="text-xs text-mute tabular-nums">
              {done}/{milestones.length} done
            </span>
          </div>
          <ol className="space-y-1">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-start gap-3 rounded-lg px-1 py-2">
                <button
                  onClick={() => setStatus(m, m.status === 'done' ? 'upcoming' : 'done')}
                  disabled={busy === m.id}
                  aria-label={m.status === 'done' ? `Reopen ${m.title}` : `Mark ${m.title} done`}
                  className={cn(
                    'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition disabled:opacity-50',
                    m.status === 'done' ? 'border-acc bg-acc text-acc-ink' : m.status === 'in_progress' ? 'border-info' : 'border-line hover:border-acc',
                  )}
                >
                  {m.status === 'done' && <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', m.status === 'done' && 'text-mute')}>{m.title}</p>
                  {m.description && <p className="text-xs text-mute">{m.description}</p>}
                </div>
                {m.due_date && <span className="hidden text-xs text-faint sm:inline">{date(m.due_date, { year: undefined })}</span>}
                <select
                  className="rounded-md border-0 bg-transparent py-0 text-xs text-mute focus:ring-1 focus:ring-acc/30"
                  value={m.status}
                  disabled={busy === m.id}
                  aria-label={`Status of ${m.title}`}
                  onChange={(e) => setStatus(m, e.target.value as MilestoneStatus)}
                >
                  {Object.entries(MILESTONE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <Badge tone={MILESTONE_TONE[m.status]} className="hidden md:inline-flex">
                  {MILESTONE_LABEL[m.status]}
                </Badge>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
