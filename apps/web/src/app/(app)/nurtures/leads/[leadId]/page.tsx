'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Check, Copy, ExternalLink, Mail, MessageSquareReply, Pause, Play, Trash2, Undo2, UserMinus } from 'lucide-react';
import { fillMerge, NURTURE_TAG_LABELS } from '@know-crm/shared';
import { get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date, dateTime, relative } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, useConfirm, useToast } from '@/components/ui';
import { AssignModal } from '@/components/nurtures/AssignModal';
import { DiscardModal } from '@/components/nurtures/DiscardModal';
import { cellTone, STATUS_LABELS } from '@/components/nurtures/PlanStrip';
import { assignmentOp, markEmail, nextLabel } from '@/components/nurtures/actions';
import { SOURCE_LABELS, type SeqEmail, type SequenceSummary, type Tracked } from '@/components/nurtures/types';

interface LeadDetail {
  lead: {
    id: string;
    name: string;
    email: string;
    state: string;
    data: Record<string, string | undefined>;
    owner_name: string | null;
    nurture: {
      tags: string[];
      reason: string;
      source: string;
      status: string;
      entered_at: string;
      revisit_date: string | null;
      discarded_at: string | null;
      discard_reason: string;
      owner_name: string | null;
    } | null;
  };
  history: { id: string; action: string; detail: { reason?: string } | null; created_at: string; actor_name: string | null }[];
}
interface NurtureDetail {
  assignment: (Tracked & { sequence: { name: string; emails: SeqEmail[] } | null }) | null;
  sequences: SequenceSummary[];
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-acc" /> : <Copy className="h-3.5 w-3.5" />} {label}
    </Button>
  );
}

export default function NurtureLeadPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const { user, workspace } = useSession();
  const lead = useLoad((s) => get<LeadDetail>(`/leads/${leadId}`, s), [leadId]);
  const nurture = useLoad((s) => get<NurtureDetail>(`/nurtures/leads/${leadId}`, s), [leadId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const reloadAll = async () => {
    await Promise.all([lead.reload(), nurture.reload()]);
  };
  const run = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(message);
      await reloadAll();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (lead.error) return <ErrorBox error={lead.error} retry={lead.reload} />;
  if (nurture.error) return <ErrorBox error={nurture.error} retry={nurture.reload} />;
  if (!lead.data || !nurture.data) return <Spinner />;
  const l = lead.data.lead;
  const n = l.nurture;
  const a = nurture.data.assignment;
  const parked = l.state === 'nurture' && n?.status === 'parked';
  const discarded = parked && !!n?.discarded_at;
  const values: Record<string, string | undefined> = {
    first_name: l.name.split(' ')[0],
    company: l.data.company,
    industry: l.data.industry,
    problem: l.data.problem,
    owner_name: l.owner_name ?? user?.name,
    booking_link: workspace?.data?.nurture?.bookingLink,
    revisit_month: n?.revisit_date ? new Date(`${n.revisit_date}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' }) : undefined,
  };
  const fill = (t: string) => fillMerge(t, values, (k) => `[${k}]`);

  return (
    <>
      <PageHeader
        back={{ href: '/nurtures?tab=tracking', label: 'Nurtures' }}
        eyebrow="Nurture lead"
        title={l.name}
        description={[l.data.company, l.email].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link href={`/leads/${l.id}`}>
              <Button variant="secondary">
                <ExternalLink className="h-4 w-4" /> Full lead
              </Button>
            </Link>
            {parked && !discarded && !a && <Button onClick={() => setAssigning(true)}>Start sequence</Button>}
            {parked && !discarded && (
              <Button variant="ghost" onClick={() => setDiscarding(true)}>
                <Trash2 className="h-4 w-4" /> Discard
              </Button>
            )}
            {discarded && (
              <Button loading={busy === 'restore'} onClick={() => run('restore', () => post(`/nurtures/leads/${l.id}/restore`), 'Restored to the General list.')}>
                <Undo2 className="h-4 w-4" /> Restore
              </Button>
            )}
          </>
        }
      />
      {!parked && (
        <div className="mb-4 rounded-xl border border-line bg-subtle px-4 py-3 text-sm text-mute">
          This lead is not parked in nurtures right now (status: {l.state}). Manage it from the{' '}
          <Link href={`/leads/${l.id}`} className="text-acc underline">
            lead page
          </Link>
          .
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {a ? (
            <Card
              title={a.sequence_name}
              action={
                <div className="flex items-center gap-1">
                  {a.paused_at ? (
                    <Button size="sm" variant="ghost" loading={busy === 'resume'} onClick={() => run('resume', () => assignmentOp(a.id, 'resume'), 'Sequence resumed.')}>
                      <Play className="h-3.5 w-3.5" /> Resume
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" loading={busy === 'pause'} onClick={() => run('pause', () => assignmentOp(a.id, 'pause'), 'Sequence paused.')}>
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === 'remove'}
                    onClick={async () => {
                      if (await confirm({ title: 'Remove from this sequence?', description: 'The lead returns to the General list.', confirmLabel: 'Remove' }))
                        await run('remove', () => assignmentOp(a.id, 'remove'), 'Removed from sequence.');
                    }}
                  >
                    <UserMinus className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              }
              bodyClassName="p-0"
            >
              <p className="border-b border-line px-4 py-2.5 text-sm text-mute">
                Started {relative(a.started_at)} · {nextLabel(a)}
              </p>
              <ol className="divide-y divide-line">
                {a.plan.map((c) => {
                  const email = a.sequence?.emails.find((e) => e.id === c.email_id);
                  const expanded = open === c.email_id;
                  const subject = fill(email?.subject ?? c.subject);
                  const body = email ? fill(email.body) + (email.signature ? `\n\n${fill(email.signature)}` : '') : '';
                  return (
                    <li key={c.email_id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : c.email_id)} aria-expanded={expanded}>
                          <p className="truncate text-sm font-medium">
                            {c.position + 1}. {subject || '(no subject)'}
                          </p>
                          <p className="text-xs text-mute">
                            {c.replied_at
                              ? `Replied ${dateTime(c.replied_at)}`
                              : c.sent_at
                                ? `Sent ${dateTime(c.sent_at)}`
                                : `Due ${dateTime(c.due_at)}`}
                          </p>
                        </button>
                        <Badge tone={cellTone(c.status)}>{STATUS_LABELS[c.status]}</Badge>
                        {!c.sent_at ? (
                          <Button
                            size="sm"
                            variant={c.status === 'due' ? 'primary' : 'secondary'}
                            loading={busy === `s${c.email_id}`}
                            onClick={() => run(`s${c.email_id}`, () => markEmail(a.id, c.email_id, { sent: true }), 'Marked sent.')}
                          >
                            Mark sent
                          </Button>
                        ) : !c.replied_at ? (
                          <>
                            <Button
                              size="sm"
                              variant="soft"
                              loading={busy === `r${c.email_id}`}
                              onClick={() => run(`r${c.email_id}`, () => markEmail(a.id, c.email_id, { replied: true }), 'Reply recorded.')}
                            >
                              <MessageSquareReply className="h-3.5 w-3.5" /> Replied
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === `u${c.email_id}`}
                              onClick={() => run(`u${c.email_id}`, () => markEmail(a.id, c.email_id, { sent: false }), 'Unmarked.')}
                            >
                              Undo
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `x${c.email_id}`}
                            onClick={() => run(`x${c.email_id}`, () => markEmail(a.id, c.email_id, { replied: false }), 'Reply removed.')}
                          >
                            Undo reply
                          </Button>
                        )}
                      </div>
                      {expanded && email && (
                        <div className="mt-3 rounded-xl border border-line bg-subtle/40 p-3 text-sm">
                          <div className="whitespace-pre-line">{body}</div>
                          <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-2">
                            <CopyText text={subject} label="Copy subject" />
                            <CopyText text={body} label="Copy body" />
                            <a href={`mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
                              <Button variant="ghost" size="sm">
                                <Mail className="h-3.5 w-3.5" /> Open in mail app
                              </Button>
                            </a>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : (
            <Card>
              <Empty
                title={discarded ? 'In Discard' : 'Not in a sequence'}
                description={discarded ? `Reason: ${n?.discard_reason || '—'}. Restore to add them to a sequence again.` : parked ? 'Start a sequence to plan follow-up emails.' : undefined}
                action={parked && !discarded ? <Button onClick={() => setAssigning(true)}>Start sequence</Button> : undefined}
              />
            </Card>
          )}
          <Card title="History" bodyClassName="p-0">
            {lead.data.history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-mute">No history yet.</p>
            ) : (
              <ol className="divide-y divide-line">
                {lead.data.history.slice(0, 30).map((h) => (
                  <li key={h.id} className="px-4 py-2.5 text-sm">
                    <p>
                      <span className="font-medium">{h.action}</span>
                      {h.detail?.reason && <span className="text-mute"> — {h.detail.reason}</span>}
                    </p>
                    <p className="text-xs text-faint">
                      {h.actor_name ?? 'System'} · {dateTime(h.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <Card title="Nurture details">
          {n ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-mute">Why parked</dt>
                <dd>{n.reason || '—'}</dd>
              </div>
              {n.tags.length > 0 && (
                <div>
                  <dt className="text-xs text-mute">Tags</dt>
                  <dd className="mt-0.5 flex flex-wrap gap-1">
                    {n.tags.map((t) => (
                      <Badge key={t}>{NURTURE_TAG_LABELS[t] ?? t}</Badge>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-mute">Source</dt>
                <dd>{SOURCE_LABELS[n.source] ?? n.source}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">In nurtures since</dt>
                <dd>{date(n.entered_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Revisit</dt>
                <dd>{n.revisit_date ? date(n.revisit_date) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Owner</dt>
                <dd>{n.owner_name ?? l.owner_name ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-mute">This lead has never been parked in nurtures.</p>
          )}
        </Card>
      </div>
      <AssignModal
        leadIds={assigning ? [l.id] : []}
        sequences={nurture.data.sequences}
        onClose={() => setAssigning(false)}
        onDone={() => {
          setAssigning(false);
          void reloadAll();
        }}
      />
      <DiscardModal
        leads={discarding ? [{ id: l.id, name: l.name }] : []}
        onClose={() => setDiscarding(false)}
        onDone={() => {
          setDiscarding(false);
          void reloadAll();
        }}
      />
    </>
  );
}
