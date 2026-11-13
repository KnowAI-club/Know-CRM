'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, PenLine, Printer, XCircle } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { dateTime } from '@/lib/format';
import { Badge, Button, ErrorBox, Field, Modal, PageHeader, Skeleton, useConfirm, useToast } from '@/components/ui';
import { DocumentView } from '@/components/projects/DocumentView';
import type { Block, DocAction, FullDocument } from '@/components/projects/documentTypes';
import { DOC_KIND_LABEL } from '@/components/projects/util';

type Question = Extract<Block, { type: 'question' }>;

export default function PortalDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: doc, error, loading, reload, setData } = useLoad((s) => get<FullDocument>(`/documents/${id}`, s), [id]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [signing, setSigning] = useState<Extract<Block, { type: 'signature' }> | null>(null);
  const [typedName, setTypedName] = useState('');
  const [consent, setConsent] = useState(false);
  const [signError, setSignError] = useState('');

  const mine = (doc?.actions ?? []).filter((a) => a.user_id === user?.id);
  const lastAnswers = [...mine].reverse().find((a) => a.action === 'answered');

  useEffect(() => {
    if (lastAnswers?.answers) setAnswers(lastAnswers.answers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAnswers?.id]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading || !doc) return <Skeleton className="h-[32rem] w-full" />;

  const record = (a: DocAction) => setData({ ...doc, actions: [...doc.actions.filter((x) => x.id !== a.id), a] });
  const onFail = (e: unknown) => {
    toast.error(e);
    if (e instanceof ApiError && e.status === 409) void reload();
  };

  const questions = doc.blocks.filter((b): b is Question => b.type === 'question');
  const decision = mine.find((a) => a.action === 'accepted' || a.action === 'declined');

  const submitAnswers = async () => {
    const missing = questions.find((q) => q.required && !(answers[q.id] ?? '').trim());
    if (missing) return toast.error(`${missing.label} is required.`);
    setBusy('answers');
    try {
      record(await post<DocAction>(`/documents/${doc.id}/responses`, { contentHash: doc.content_hash, answers }));
      toast.success('Answers sent to the team');
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(null);
    }
  };

  const decide = async (value: 'accepted' | 'declined') => {
    if (
      !(await confirm({
        title: value === 'accepted' ? 'Accept this proposal?' : 'Decline this proposal?',
        description: 'Your decision is recorded and cannot be changed. Ask the team for a revised proposal if needed.',
        confirmLabel: value === 'accepted' ? 'Accept' : 'Decline',
        danger: value === 'declined',
      }))
    )
      return;
    setBusy(value);
    try {
      record(await post<DocAction>(`/documents/${doc.id}/decision`, { contentHash: doc.content_hash, decision: value }));
      toast.success(value === 'accepted' ? 'Proposal accepted. Thank you!' : 'Your decision has been recorded.');
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(null);
    }
  };

  const sign = async () => {
    if (!signing) return;
    if (typedName.trim().length < 2) return setSignError('Type your full name.');
    if (!consent) return setSignError('Confirm you agree to sign electronically.');
    setBusy('sign');
    try {
      record(await post<DocAction>(`/documents/${doc.id}/sign`, { contentHash: doc.content_hash, blockId: signing.id, typedName: typedName.trim(), consent: true }));
      setSigning(null);
      toast.success('Signed');
    } catch (e) {
      setSignError(e instanceof Error ? e.message : String(e));
      onFail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader
          back={{ href: `/portal/projects/${doc.project_id}?tab=documents`, label: 'Documents' }}
          eyebrow={DOC_KIND_LABEL[doc.kind]}
          title={doc.title}
          description={`Shared ${dateTime(doc.published_at)}`}
          actions={
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          }
        />
      </div>
      <div className="card p-6 sm:p-10">
        <DocumentView
          title={doc.title}
          blocks={doc.blocks}
          renderQuestion={(q) =>
            q.questionType === 'choice' ? (
              <div className="space-y-1.5" role="radiogroup" aria-label={q.label}>
                {q.options.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => setAnswers({ ...answers, [q.id]: o })} /> {o}
                  </label>
                ))}
              </div>
            ) : q.questionType === 'long' ? (
              <textarea className="input" rows={4} maxLength={20000} aria-label={q.label} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            ) : (
              <input className="input" maxLength={500} aria-label={q.label} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            )
          }
          renderSignature={(b) => {
            const s = doc.actions.find((a) => a.action === 'signed' && a.block_id === b.id);
            if (s)
              return (
                <div>
                  <p className="font-serif text-2xl italic">{s.typed_name}</p>
                  <p className="mt-1 text-xs text-mute">
                    Signed electronically by {s.actor_name} · {dateTime(s.created_at)}
                  </p>
                </div>
              );
            return doc.kind === 'contract' ? (
              <Button
                onClick={() => {
                  setSigning(b);
                  setTypedName(user?.name ?? '');
                  setConsent(false);
                  setSignError('');
                }}
              >
                <PenLine className="h-4 w-4" /> Sign here
              </Button>
            ) : (
              <p className="text-sm text-mute">Awaiting signature</p>
            );
          }}
        />

        {questions.length > 0 && (
          <div className="no-print mx-auto mt-6 flex max-w-3xl flex-wrap items-center gap-3 border-t border-line pt-6">
            {lastAnswers && <span className="text-xs text-mute">Last sent {dateTime(lastAnswers.created_at)}. You can update your answers.</span>}
            <Button className="ml-auto" onClick={submitAnswers} loading={busy === 'answers'}>
              {lastAnswers ? 'Send updated answers' : 'Send answers'}
            </Button>
          </div>
        )}

        {doc.kind === 'proposal' && (
          <div className="no-print mx-auto mt-6 max-w-3xl border-t border-line pt-6">
            {decision ? (
              <div className="flex items-center gap-2">
                {decision.action === 'accepted' ? <CheckCircle2 className="h-5 w-5 text-ok" /> : <XCircle className="h-5 w-5 text-danger" />}
                <p className="text-sm">
                  You {decision.action} this proposal on {dateTime(decision.created_at)}.
                </p>
                <Badge tone={decision.action === 'accepted' ? 'ok' : 'danger'} className="ml-auto">
                  {decision.action === 'accepted' ? 'Accepted' : 'Declined'}
                </Badge>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-sm text-mute">Happy with this proposal? Let the team know.</p>
                <Button variant="secondary" onClick={() => decide('declined')} loading={busy === 'declined'}>
                  Decline
                </Button>
                <Button onClick={() => decide('accepted')} loading={busy === 'accepted'}>
                  Accept proposal
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={!!signing}
        onClose={() => setSigning(null)}
        title={signing?.label ?? 'Sign'}
        description="Type your full name to sign this contract electronically."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSigning(null)}>
              Cancel
            </Button>
            <Button onClick={sign} loading={busy === 'sign'} disabled={!consent}>
              Sign contract
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Full name" error={signError}>
            <input className="input" value={typedName} maxLength={200} onChange={(e) => setTypedName(e.target.value)} autoComplete="name" />
          </Field>
          {typedName.trim() && <p className="rounded-lg bg-subtle px-4 py-3 font-serif text-2xl italic">{typedName}</p>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{doc.consentText}</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
