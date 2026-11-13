'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowLeftRight, LogOut, Trophy, Undo2 } from 'lucide-react';
import { EXIT_LABELS, type ExitStatus } from '@know-crm/shared';
import { patch, post } from '@/lib/api';
import { date, relative } from '@/lib/format';
import { Badge, Button, Card, Field, useConfirm, useToast } from '@/components/ui';
import { LeadActionModal, type LeadAction } from './LeadActionModals';
import { isConflict, STATE_LABELS, STATE_TONES, type Lead, type Stage } from './types';

/** Pipeline state, stage and the actions available for this lead. */
export function LeadStatusCard({
  lead,
  stages,
  onChanged,
  onConflict,
}: {
  lead: Lead;
  stages: Stage[];
  onChanged: (lead: Lead) => void;
  onConflict: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [action, setAction] = useState<LeadAction | null>(null);
  const [busy, setBusy] = useState(false);
  const open = stages.filter((s) => s.kind === 'open');
  const stage = stages.find((s) => s.id === lead.stage);

  const fail = (e: unknown) => {
    toast.error(e);
    if (isConflict(e) && /changed/i.test((e as Error).message)) onConflict();
  };

  const moveStage = async (stageId: string) => {
    setBusy(true);
    try {
      const updated = await patch<Lead>(`/leads/${lead.id}`, { version: lead.version, stage: stageId });
      onChanged(updated);
      toast.success(`Moved to ${stages.find((s) => s.id === stageId)?.label ?? 'stage'}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const ok = await confirm({
      title: 'Back to pipeline',
      description: 'The lead returns to the pipeline at the stage it left from.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await post<Lead>(`/leads/${lead.id}/action`, { action: 'restore', version: lead.version });
      onChanged(updated);
      toast.success('Lead is back in the pipeline');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Status" icon={<ArrowLeftRight className="h-4 w-4" />}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONES[lead.state]}>{STATE_LABELS[lead.state]}</Badge>
          {lead.exit_status && <Badge tone="warn">{EXIT_LABELS[lead.exit_status as ExitStatus] ?? lead.exit_status}</Badge>}
          {stage && (
            <span className="inline-flex items-center gap-1.5 text-xs text-mute">
              <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
              {stage.label}
            </span>
          )}
        </div>

        {lead.state === 'active' && (
          <Field label="Stage" hint={`In this stage ${relative(lead.stage_changed_at).replace(' ago', '')}`}>
            <select className="input" value={lead.stage} disabled={busy} onChange={(e) => void moveStage(e.target.value)}>
              {open.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {lead.state === 'won' && (
          <div className="rounded-xl bg-ok-soft p-3 text-sm">
            <p className="font-medium text-ok">Closed won {lead.won_at ? `on ${date(lead.won_at)}` : ''}</p>
            {lead.project_id && (
              <Link href={`/projects/${lead.project_id}`} className="mt-1 inline-block text-acc underline">
                {lead.project_name ?? 'Open project'}
                {lead.project_archived ? ' (archived)' : ''}
              </Link>
            )}
          </div>
        )}

        {lead.state === 'dropped' && (lead.exit_reason || lead.resume_date) && (
          <dl className="space-y-1 text-sm">
            {lead.exit_reason && (
              <div>
                <dt className="text-xs text-mute">Exit reason</dt>
                <dd className="whitespace-pre-wrap">{lead.exit_reason}</dd>
              </div>
            )}
            {lead.resume_date && (
              <div>
                <dt className="text-xs text-mute">Resume date</dt>
                <dd>{date(lead.resume_date)}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="flex flex-wrap gap-2">
          {lead.state === 'active' && (
            <>
              <Button size="sm" onClick={() => setAction('won')} disabled={busy}>
                <Trophy className="h-3.5 w-3.5" /> Close won
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAction('exit')} disabled={busy}>
                <LogOut className="h-3.5 w-3.5" /> Exit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAction('archive')} disabled={busy}>
                <Archive className="h-3.5 w-3.5" /> Archive
              </Button>
            </>
          )}
          {lead.state === 'dropped' && (
            <Button size="sm" variant="secondary" onClick={() => void restore()} disabled={busy}>
              <Undo2 className="h-3.5 w-3.5" /> Back to pipeline
            </Button>
          )}
        </div>
      </div>
      <LeadActionModal
        lead={lead}
        action={action}
        stages={stages}
        onClose={() => setAction(null)}
        onDone={onChanged}
        onConflict={onConflict}
      />
    </Card>
  );
}
