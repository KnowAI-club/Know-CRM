'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { patch } from '@/lib/api';
import { useTeam } from '@/lib/team';
import { Badge, Button, Card, Field, MentionTextarea, useToast } from '@/components/ui';
import { OUTCOMES, formErrors } from './util';
import type { Meeting } from './meetings';
import { useNow } from './useNow';

export interface NextStep {
  id: string;
  text: string;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  task_id: string | null;
  task_completed: boolean | null;
}

interface Draft {
  id?: string;
  key: string;
  text: string;
  ownerId: string;
  dueDate: string;
  taskId?: string | null;
  done?: boolean;
}

const toDraft = (s: NextStep): Draft => ({
  id: s.id,
  key: s.id,
  text: s.text,
  ownerId: s.owner_id ?? '',
  dueDate: s.due_date ?? '',
  taskId: s.task_id,
  done: !!s.task_completed,
});

/** Outcome, notes, decisions and next steps for a meeting. */
export function MeetingRecord({
  meeting,
  nextSteps,
  onSaved,
}: {
  meeting: Meeting;
  nextSteps: NextStep[];
  onSaved: (patch: Partial<Meeting>, steps: NextStep[]) => void;
}) {
  const toast = useToast();
  const team = useTeam();
  const [outcome, setOutcome] = useState(meeting.outcome ?? '');
  const [reason, setReason] = useState(meeting.outcome_reason ?? '');
  const [summary, setSummary] = useState(meeting.summary ?? '');
  const [decisions, setDecisions] = useState(meeting.decisions ?? '');
  const [steps, setSteps] = useState<Draft[]>(nextSteps.map(toDraft));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [saving, setSaving] = useState(false);
  const now = useNow();

  useEffect(() => {
    setOutcome(meeting.outcome ?? '');
    setReason(meeting.outcome_reason ?? '');
    setSummary(meeting.summary ?? '');
    setDecisions(meeting.decisions ?? '');
  }, [meeting.outcome, meeting.outcome_reason, meeting.summary, meeting.decisions]);
  useEffect(() => setSteps(nextSteps.map(toDraft)), [nextSteps]);

  const cancelled = meeting.status === 'cancelled';
  const started = new Date(meeting.start_at).getTime() <= now;
  const dirty =
    outcome !== (meeting.outcome ?? '') ||
    reason !== (meeting.outcome_reason ?? '') ||
    summary !== (meeting.summary ?? '') ||
    decisions !== (meeting.decisions ?? '') ||
    JSON.stringify(steps.map(({ id, text, ownerId, dueDate }) => ({ id, text, ownerId, dueDate }))) !==
      JSON.stringify(nextSteps.map(toDraft).map(({ id, text, ownerId, dueDate }) => ({ id, text, ownerId, dueDate })));

  const updateStep = (key: string, k: keyof Draft, v: string) => {
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, [k]: v } : s)));
    setErrors((e) => ({ ...e, [`step-${key}`]: '' }));
  };

  const save = async () => {
    const local: Record<string, string> = {};
    if ((outcome === 'rescheduled' || outcome === 'cancelled') && !reason.trim()) local.outcomeReason = 'Add a reason.';
    for (const s of steps) if (!s.text.trim()) local[`step-${s.key}`] = 'Describe the next step.';
    if (Object.keys(local).length) return setErrors(local);
    setSaving(true);
    setGeneral('');
    setErrors({});
    try {
      const res = await patch<{ nextSteps: NextStep[] }>(`/meetings/${meeting.id}/record`, {
        outcome: outcome || null,
        outcomeReason: reason.trim(),
        summary,
        decisions,
        nextSteps: steps.map((s) => ({ ...(s.id ? { id: s.id } : {}), text: s.text.trim(), ownerId: s.ownerId, dueDate: s.dueDate })),
      });
      onSaved({ outcome: outcome || null, outcome_reason: reason.trim(), summary, decisions }, res.nextSteps);
      toast.success('Meeting record saved');
    } catch (err) {
      const f = formErrors(err, ['outcome', 'outcomeReason', 'summary', 'decisions', 'nextSteps']);
      setErrors(f.fields);
      setGeneral(f.general || f.fields.nextSteps || '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Record"
      icon={<CheckCircle2 className="h-4 w-4" />}
      action={
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
          Save record
        </Button>
      }
    >
      <div className="space-y-4">
        {general && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{general}</p>}
        {!cancelled && (
          <div>
            <span className="label">Outcome</span>
            {!started && <p className="mb-2 text-xs text-faint">You can record the outcome once the meeting starts.</p>}
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={!started}
                  aria-pressed={outcome === o.value}
                  onClick={() => setOutcome(outcome === o.value ? '' : o.value)}
                  className={
                    outcome === o.value
                      ? 'rounded-full border border-acc bg-acc-soft px-3 py-1 text-sm text-acc'
                      : 'rounded-full border border-line px-3 py-1 text-sm text-mute hover:text-ink disabled:opacity-50'
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            {(outcome === 'rescheduled' || outcome === 'cancelled') && (
              <Field label="Reason" required error={errors.outcomeReason} className="mt-3">
                <input className="input" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        <div>
          <span className="label">Summary</span>
          <MentionTextarea value={summary} onChange={setSummary} rows={4} placeholder="What was discussed? Type @ to mention a teammate." />
          {errors.summary && <span className="mt-1 block text-xs text-danger">{errors.summary}</span>}
        </div>
        <div>
          <span className="label">Decisions</span>
          <MentionTextarea value={decisions} onChange={setDecisions} rows={3} placeholder="What was agreed?" />
        </div>
        {!cancelled && (
          <div>
            <span className="label">Next steps</span>
            <p className="mb-2 text-xs text-faint">Steps with an owner and a due date become tasks automatically.</p>
            <div className="space-y-2">
              {steps.map((s) => (
                <div key={s.key} className="rounded-lg border border-line p-2.5">
                  <div className="flex items-start gap-2">
                    <input
                      className="input flex-1"
                      value={s.text}
                      maxLength={500}
                      aria-label="Next step"
                      placeholder="Send revised estimate"
                      onChange={(e) => updateStep(s.key, 'text', e.target.value)}
                    />
                    <Button variant="ghost" size="icon" aria-label="Remove step" onClick={() => setSteps((l) => l.filter((x) => x.key !== s.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {errors[`step-${s.key}`] && <span className="mt-1 block text-xs text-danger">{errors[`step-${s.key}`]}</span>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select className="input w-auto" aria-label="Owner" value={s.ownerId} onChange={(e) => updateStep(s.key, 'ownerId', e.target.value)}>
                      <option value="">No owner</option>
                      {team.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <input type="date" className="input w-auto" aria-label="Due date" value={s.dueDate} onChange={(e) => updateStep(s.key, 'dueDate', e.target.value)} />
                    {s.taskId && <Badge tone={s.done ? 'ok' : 'acc'}>{s.done ? 'Task done' : 'Task created'}</Badge>}
                  </div>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSteps((l) => [...l, { key: crypto.randomUUID(), text: '', ownerId: '', dueDate: '' }])}
                disabled={steps.length >= 50}
              >
                <Plus className="h-3.5 w-3.5" /> Add next step
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
