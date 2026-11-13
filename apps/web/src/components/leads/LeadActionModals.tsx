'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EXIT_HELP, EXIT_LABELS, EXIT_STATUSES, NURTURE_TAGS, NURTURE_TAG_LABELS, type ExitStatus } from '@know-crm/shared';
import { post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { today } from '@/lib/format';
import { Button, Field, Modal, MoneyInput, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { OwnerSelect } from './OwnerSelect';
import { isConflict, withDefaults, type Lead, type Stage } from './types';

export type LeadAction = 'exit' | 'nurture' | 'archive' | 'won';

/** Choose 1–3 nurture tags. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Nurture tags">
      {NURTURE_TAGS.map((t) => {
        const on = value.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t].slice(0, 3))}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              on ? 'border-acc bg-acc-soft text-acc' : 'border-line text-mute hover:text-ink',
            )}
          >
            {NURTURE_TAG_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

const TITLES: Record<LeadAction, { title: string; description: string; cta: string }> = {
  exit: { title: 'Exit the pipeline', description: 'Record why this lead is leaving. Most exits park it in Nurtures.', cta: 'Exit lead' },
  nurture: { title: 'Move to Nurtures', description: 'Park this lead with a POC who will follow up later.', cta: 'Move to Nurtures' },
  archive: { title: 'Archive lead', description: 'Archived leads leave the pipeline and can be restored later.', cta: 'Archive' },
  won: { title: 'Close won', description: 'Creates (or links) the delivery project and hands the lead off.', cta: 'Close won' },
};

/** Exit, nurture, archive and close-won dialogs for a lead. */
export function LeadActionModal({
  lead,
  action,
  stages,
  onClose,
  onDone,
  onConflict,
}: {
  lead: Lead;
  action: LeadAction | null;
  stages: Stage[];
  onClose: () => void;
  onDone: (lead: Lead) => void;
  onConflict: () => void;
}) {
  const { currency } = useSession();
  const toast = useToast();
  const data = withDefaults(lead.data);
  const wonStages = stages.filter((s) => s.kind === 'won');
  const [exitStatus, setExitStatus] = useState<ExitStatus | ''>('');
  const [reason, setReason] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState(data.ownerId);
  const [resumeDate, setResumeDate] = useState('');
  const [revisitDate, setRevisitDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [wonProject, setWonProject] = useState<Lead | null>(null);

  useEffect(() => {
    if (!action) return;
    setExitStatus('');
    setReason('');
    setTags([]);
    setOwnerId(withDefaults(lead.data).ownerId);
    setResumeDate('');
    setRevisitDate('');
    setDueDate('');
    setValue(null);
    setStageId(stages.find((s) => s.kind === 'won')?.id ?? '');
    setError('');
    setWonProject(null);
    // Reset only when the dialog opens for a lead; later lead refreshes must not clear the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, lead.id]);

  if (!action) return null;
  const meta = TITLES[action];
  const archivedExit = action === 'exit' && exitStatus === 'disqualified';
  const onHold = action === 'exit' && exitStatus === 'on_hold';
  const needsNurture = action === 'nurture' || (action === 'exit' && exitStatus && !archivedExit);
  const needsRevisit = needsNurture && !onHold && tags.includes('not_ready');

  const validate = () => {
    if (action === 'exit' && !exitStatus) return 'Choose an exit status.';
    if (action !== 'won' && !reason.trim()) return 'Add a reason.';
    if (onHold && !resumeDate) return 'Add a resume date.';
    if (needsNurture && tags.length < 1) return 'Choose at least one nurture tag.';
    if (needsNurture && !ownerId) return 'Assign a POC for this lead.';
    if (needsRevisit && !revisitDate) return 'Add a revisit date.';
    if (action === 'won') {
      if (!data.ownerId) return 'Assign an owner before closing won.';
      if (!dueDate) return 'Enter the project due date before closing won.';
      if (value === null) return 'Enter a valid project value.';
    }
    return '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setSaving(true);
    const body: Record<string, unknown> = { action, version: lead.version, reason: reason.trim() };
    if (action === 'exit') {
      body.exitStatus = exitStatus;
      if (onHold) body.resumeDate = resumeDate;
    }
    if (needsNurture) {
      body.tags = tags;
      body.ownerId = ownerId;
      if (onHold) body.revisitDate = resumeDate;
      else if (revisitDate) body.revisitDate = revisitDate;
    }
    if (action === 'won') {
      body.dueDate = dueDate;
      body.value = value ?? 0;
      if (stageId) body.stageId = stageId;
    }
    try {
      const updated = await post<Lead>(`/leads/${lead.id}/action`, body);
      if (action === 'won') {
        setWonProject(updated);
        onDone(updated);
      } else {
        toast.success(
          action === 'archive' || archivedExit ? 'Lead archived' : action === 'exit' ? 'Lead moved to Nurtures' : 'Lead moved to Nurtures',
        );
        onDone(updated);
        onClose();
      }
    } catch (err) {
      if (isConflict(err) && /changed/i.test(String((err as Error).message))) {
        toast.error(err);
        onConflict();
        onClose();
      } else setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (wonProject)
    return (
      <Modal open onClose={onClose} title="Closed won 🎉" size="sm" footer={<Button variant="secondary" onClick={onClose}>Stay here</Button>}>
        <p className="text-sm text-mute">
          {lead.name} is now a client. Open lead tasks and meetings moved to the delivery project.
        </p>
        {wonProject.project_id && (
          <Link href={`/projects/${wonProject.project_id}`} className="mt-4 inline-flex">
            <Button>Open project</Button>
          </Link>
        )}
      </Modal>
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={meta.title}
      description={meta.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-action" variant={action === 'archive' || archivedExit ? 'danger' : 'primary'} loading={saving}>
            {archivedExit ? 'Disqualify & archive' : meta.cta}
          </Button>
        </>
      }
    >
      <form id="lead-action" onSubmit={submit} className="space-y-4" noValidate>
        {action === 'exit' && (
          <fieldset>
            <legend className="label">Exit status</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXIT_STATUSES.map((s) => (
                <label
                  key={s}
                  className={cn(
                    'cursor-pointer rounded-xl border p-3 text-sm transition',
                    exitStatus === s ? 'border-acc bg-acc-soft' : 'border-line hover:bg-subtle',
                  )}
                >
                  <input type="radio" name="exit" className="sr-only" checked={exitStatus === s} onChange={() => setExitStatus(s)} />
                  <span className="font-medium">{EXIT_LABELS[s]}</span>
                  <span className="mt-0.5 block text-xs text-mute">{EXIT_HELP[s]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {action === 'won' && (
          <>
            {!data.ownerId && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Assign an owner on the profile before closing won.</p>
            )}
            {wonStages.length > 1 && (
              <Field label="Closed-won stage">
                <select className="input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {wonStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project due date" required>
                <input className="input" type="date" min={today()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="Project value" hint="Agreed contract value">
                <MoneyInput value={value} onChange={setValue} currency={currency} />
              </Field>
            </div>
          </>
        )}

        {action !== 'won' && (
          <Field label="Reason" required>
            <textarea className="input" rows={3} maxLength={10000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}

        {onHold && (
          <Field label="Resume date" required hint="The POC is reminded to revisit on this date.">
            <input className="input" type="date" min={today()} value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} />
          </Field>
        )}

        {needsNurture && (
          <>
            <div>
              <p className="label">Nurture tags (1–3)</p>
              <TagPicker value={tags} onChange={setTags} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nurture POC" required>
                <OwnerSelect value={ownerId} onChange={setOwnerId} emptyLabel="Choose a teammate" />
              </Field>
              {!onHold && (
                <Field label="Revisit date" required={Boolean(needsRevisit)} hint={needsRevisit ? 'Required for Not ready' : 'Optional'}>
                  <input className="input" type="date" min={today()} value={revisitDate} onChange={(e) => setRevisitDate(e.target.value)} />
                </Field>
              )}
            </div>
          </>
        )}

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
