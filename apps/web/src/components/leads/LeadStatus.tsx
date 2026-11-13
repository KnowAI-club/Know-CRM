'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowLeftRight, CheckCircle2, LogOut, MessageCircleReply, PauseCircle, Trophy, Undo2 } from 'lucide-react';
import { EXIT_LABELS, NURTURE_TAG_LABELS, type ExitStatus } from '@know-crm/shared';
import { patch, post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { date, dateTime, relative, today } from '@/lib/format';
import { Badge, Button, Card, Field, Modal, useConfirm, useToast } from '@/components/ui';
import { LeadActionModal, TagPicker, type LeadAction } from './LeadActionModals';
import { OwnerSelect } from './OwnerSelect';
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

  const bringBack = async (kind: 'restore' | 'reply') => {
    const ok = await confirm({
      title: kind === 'reply' ? 'Lead replied' : 'Back to pipeline',
      description:
        kind === 'reply'
          ? 'The lead returns to the stage it left from and its nurture sequence ends.'
          : 'The lead returns to the pipeline at the stage it left from.',
      confirmLabel: kind === 'reply' ? 'Mark replied' : 'Restore',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await post<Lead>(`/leads/${lead.id}/action`, { action: kind, version: lead.version });
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

        {(lead.state === 'nurture' || lead.state === 'dropped') && (lead.exit_reason || lead.resume_date) && (
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
              <Button size="sm" variant="secondary" onClick={() => setAction('nurture')} disabled={busy}>
                <PauseCircle className="h-3.5 w-3.5" /> Nurture
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAction('exit')} disabled={busy}>
                <LogOut className="h-3.5 w-3.5" /> Exit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAction('archive')} disabled={busy}>
                <Archive className="h-3.5 w-3.5" /> Archive
              </Button>
            </>
          )}
          {(lead.state === 'nurture' || lead.state === 'dropped') && (
            <>
              <Button size="sm" onClick={() => void bringBack('reply')} disabled={busy}>
                <MessageCircleReply className="h-3.5 w-3.5" /> Lead replied
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void bringBack('restore')} disabled={busy}>
                <Undo2 className="h-3.5 w-3.5" /> Back to pipeline
              </Button>
            </>
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

type NurtureOp = 'save' | 'archive' | 'repark';

/** Nurture management: edit, confirm, archive or re-park. */
export function NurtureCard({ lead, onChanged, onConflict }: { lead: Lead; onChanged: (l: Lead) => void; onConflict: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const n = lead.nurture;
  const [op, setOp] = useState<NurtureOp | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [revisit, setRevisit] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!op || !n) return;
    setTags(n.tags.filter((t) => t !== 'archived'));
    setOwnerId(n.owner_id);
    setRevisit(n.revisit_date ?? '');
    setReason(op === 'archive' ? '' : n.reason);
    setError('');
  }, [op, n]);

  if (!n) return null;
  const onHold = lead.exit_status === 'on_hold';
  const canConfirm = n.status === 'parked' && !n.confirmed_at && n.owner_id === user?.id;
  const overdue = n.status === 'parked' && !n.confirmed_at && n.confirmation_due_at && new Date(n.confirmation_due_at) < new Date();

  const send = async (operation: NurtureOp | 'confirm') => {
    const body: Record<string, unknown> = { version: lead.version, operation };
    if (operation === 'archive') {
      if (!reason.trim()) return setError('Add a reason.');
      body.reason = reason.trim();
    } else if (operation !== 'confirm') {
      if (!tags.length) return setError('Choose at least one nurture tag.');
      if (!reason.trim()) return setError('Add a reason.');
      if ((tags.includes('not_ready') || onHold) && !revisit) return setError('Add a revisit date.');
      Object.assign(body, { tags, ownerId, revisitDate: revisit || null, reason: reason.trim() });
    }
    setSaving(true);
    try {
      const updated = await patch<Lead>(`/leads/${lead.id}/nurture`, body);
      onChanged(updated);
      toast.success(operation === 'confirm' ? 'Nurture confirmed' : operation === 'archive' ? 'Nurture archived' : 'Nurture saved');
      setOp(null);
    } catch (e) {
      if (isConflict(e) && /changed/i.test((e as Error).message)) {
        toast.error(e);
        onConflict();
        setOp(null);
      } else if (op) setError((e as Error).message);
      else toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Nurture" icon={<PauseCircle className="h-4 w-4" />}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-mute">Status</dt>
          <dd>
            <Badge tone={n.status === 'parked' ? 'warn' : 'neutral'}>{n.status === 'parked' ? 'Parked' : 'Archived'}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-mute">POC</dt>
          <dd>{n.owner_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Revisit</dt>
          <dd>{date(n.revisit_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Parked</dt>
          <dd>{date(n.entered_at)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="mb-1 text-xs text-mute">Tags</dt>
          <dd className="flex flex-wrap gap-1">
            {n.tags.length ? n.tags.map((t) => <Badge key={t} tone="info">{NURTURE_TAG_LABELS[t] ?? t}</Badge>) : '—'}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-mute">{n.status === 'archived' ? 'Archive reason' : 'Reason'}</dt>
          <dd className="whitespace-pre-wrap">{(n.status === 'archived' ? n.archive_reason : n.reason) || '—'}</dd>
        </div>
        {n.status === 'parked' && (
          <div className="col-span-2">
            <dt className="text-xs text-mute">POC confirmation</dt>
            <dd className={overdue ? 'text-danger' : ''}>
              {n.confirmed_at ? (
                <span className="inline-flex items-center gap-1 text-ok">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed by {n.confirmed_by_name ?? 'POC'} · {date(n.confirmed_at)}
                </span>
              ) : (
                `Due ${dateTime(n.confirmation_due_at)}${overdue ? ' (overdue)' : ''}`
              )}
            </dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {canConfirm && (
          <Button size="sm" onClick={() => void send('confirm')} loading={saving && !op}>
            Confirm nurture
          </Button>
        )}
        {n.status === 'parked' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setOp('save')}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOp('archive')}>
              Archive
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setOp('repark')}>
            Re-park in Nurtures
          </Button>
        )}
      </div>

      <Modal
        open={op !== null}
        onClose={() => setOp(null)}
        title={op === 'archive' ? 'Archive nurture' : op === 'repark' ? 'Re-park lead' : 'Edit nurture'}
        description={op === 'save' ? 'Changing the POC asks the new owner to confirm.' : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOp(null)}>
              Cancel
            </Button>
            <Button variant={op === 'archive' ? 'danger' : 'primary'} loading={saving} onClick={() => op && void send(op)}>
              {op === 'archive' ? 'Archive' : op === 'repark' ? 'Re-park' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {op !== 'archive' && (
            <>
              <div>
                <p className="label">Tags (1–3)</p>
                <TagPicker value={tags} onChange={setTags} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="POC" required>
                  <OwnerSelect value={ownerId} onChange={setOwnerId} emptyLabel={null} />
                </Field>
                <Field label="Revisit date" hint={onHold ? 'Also updates the resume date.' : undefined}>
                  <input className="input" type="date" min={today()} value={revisit} onChange={(e) => setRevisit(e.target.value)} />
                </Field>
              </div>
            </>
          )}
          <Field label="Reason" required>
            <textarea className="input" rows={3} maxLength={10000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        </div>
      </Modal>
    </Card>
  );
}
