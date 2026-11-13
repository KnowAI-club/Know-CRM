'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, Eye, PenLine, Send, Trash2, XCircle } from 'lucide-react';
import { del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton, useConfirm, useToast } from '@/components/ui';
import { BlockEditor } from '@/components/projects/BlockEditor';
import { DocumentView } from '@/components/projects/DocumentView';
import type { Block, DocAction, FullDocument } from '@/components/projects/documentTypes';
import { DOC_KIND_LABEL, fieldErrors } from '@/components/projects/util';

const clean = (blocks: Block[]): Block[] =>
  blocks.map((b) => (b.type === 'question' ? { ...b, options: b.options.map((o) => o.trim()).filter(Boolean) } : b));

function ActionRow({ a, blocks }: { a: DocAction; blocks: Block[] }) {
  const label = (id: string) =>
    blocks.find((b) => b.id === id && b.type === 'question') as Extract<Block, { type: 'question' }> | undefined;
  return (
    <li className="py-3">
      <div className="flex items-center gap-2">
        {a.action === 'accepted' && <CheckCircle2 className="h-4 w-4 text-ok" />}
        {a.action === 'declined' && <XCircle className="h-4 w-4 text-danger" />}
        {a.action === 'signed' && <PenLine className="h-4 w-4 text-acc" />}
        {a.action === 'answered' && <Send className="h-4 w-4 text-info" />}
        <p className="text-sm">
          <span className="font-medium">{a.actor_name}</span>{' '}
          {a.action === 'answered'
            ? 'submitted answers'
            : a.action === 'signed'
              ? `signed as “${a.typed_name}”`
              : `${a.action} the proposal`}
        </p>
        <span className="ml-auto text-xs text-faint">{dateTime(a.created_at)}</span>
      </div>
      {a.action === 'answered' && a.answers && (
        <dl className="mt-2 space-y-2 rounded-lg bg-subtle/60 p-3">
          {Object.entries(a.answers).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-mute">{label(k)?.label ?? k}</dt>
              <dd className="text-sm whitespace-pre-wrap">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { currency } = useSession();
  const { data: doc, error, loading, reload, setData } = useLoad((s) => get<FullDocument>(`/documents/${id}`, s), [id]);
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'publish' | 'delete' | null>(null);
  const saved = useRef('');

  useEffect(() => {
    if (!doc) return;
    setTitle(doc.title);
    setBlocks(doc.blocks);
    saved.current = JSON.stringify({ t: doc.title, b: doc.blocks });
  }, [doc]);

  const dirty = useMemo(
    () => !!doc && doc.status === 'draft' && JSON.stringify({ t: title, b: blocks }) !== saved.current,
    [doc, title, blocks],
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading || !doc)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );

  const save = async (quiet = false) => {
    const local: Record<string, string> = {};
    if (!title.trim()) local.title = 'Add a title.';
    blocks.forEach((b, i) => {
      if (b.type === 'service' && !(b.quantity > 0 && b.quantity <= 100000))
        local[`blocks.${i}.quantity`] = 'Quantity above 0, up to 100000.';
    });
    if (Object.keys(local).length) {
      setErrors(local);
      return false;
    }
    setBusy('save');
    try {
      const next = clean(blocks);
      const row = await patch<FullDocument>(`/documents/${doc.id}`, { title, blocks: next });
      setData({ ...doc, ...row, actions: doc.actions, consentText: doc.consentText });
      setErrors({});
      if (!quiet) toast.success('Draft saved');
      return true;
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (
      !(await confirm({
        title: 'Publish to the client portal?',
        description: 'The client will be able to see this document. Published documents are locked and kept as a record.',
        confirmLabel: 'Publish',
      }))
    )
      return;
    if (dirty && !(await save(true))) return;
    setBusy('publish');
    try {
      const row = await post<FullDocument>(`/documents/${doc.id}/publish`);
      setData({ ...doc, ...row, actions: doc.actions, consentText: doc.consentText });
      toast.success('Published to the client portal');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this draft?', description: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })))
      return;
    setBusy('delete');
    try {
      await del(`/documents/${doc.id}`);
      saved.current = JSON.stringify({ t: title, b: blocks });
      router.push(`/projects/${doc.project_id}?tab=documents`);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  const isDraft = doc.status === 'draft';
  const signatures = blocks.filter((b) => b.type === 'signature');
  const decision = doc.actions.find((a) => a.action === 'accepted' || a.action === 'declined');

  return (
    <div>
      <PageHeader
        back={{ href: `/projects/${doc.project_id}?tab=documents`, label: 'Project documents' }}
        eyebrow={DOC_KIND_LABEL[doc.kind]}
        title={isDraft ? title || 'Untitled document' : doc.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {isDraft ? <Badge>Draft</Badge> : <Badge tone="ok">Published {dateTime(doc.published_at)}</Badge>}
            {decision && (
              <Badge tone={decision.action === 'accepted' ? 'ok' : 'danger'}>
                {decision.action === 'accepted' ? 'Accepted' : 'Declined'}
              </Badge>
            )}
            {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
          </span>
        }
        actions={
          isDraft && (
            <>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'edit', label: 'Edit', icon: <PenLine className="h-3.5 w-3.5" /> },
                  { value: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" /> },
                ]}
              />
              <Button variant="ghost" onClick={remove} loading={busy === 'delete'} aria-label="Delete draft">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button variant="secondary" onClick={() => save()} loading={busy === 'save'} disabled={!dirty}>
                Save draft
              </Button>
              <Button onClick={publish} loading={busy === 'publish'}>
                <Send className="h-4 w-4" /> Publish
              </Button>
            </>
          )
        }
      />

      {isDraft ? (
        mode === 'edit' ? (
          <div className="mx-auto max-w-3xl space-y-4">
            <div>
              <label className="label" htmlFor="doc-title">
                Title
              </label>
              <input
                id="doc-title"
                className="input text-base font-medium"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
              {errors.title && <p className="mt-1 text-xs text-danger">{errors.title}</p>}
            </div>
            {errors.blocks && <ErrorBox error={errors.blocks} />}
            {doc.kind === 'contract' && !signatures.length && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                Contracts need at least one signature block before publishing.
              </p>
            )}
            <BlockEditor blocks={blocks} onChange={setBlocks} currency={currency} errors={errors} />
          </div>
        ) : (
          <div className="card p-6 sm:p-10">
            <DocumentView title={title} blocks={blocks} />
          </div>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-6 sm:p-10 lg:col-span-2">
            <DocumentView
              title={doc.title}
              blocks={doc.blocks}
              renderSignature={(b) => {
                const s = doc.actions.find((a) => a.action === 'signed' && a.block_id === b.id);
                return s ? (
                  <div>
                    <p className="font-serif text-2xl italic">{s.typed_name}</p>
                    <p className="mt-1 text-xs text-mute">
                      Signed electronically by {s.actor_name} · {dateTime(s.created_at)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-mute">Awaiting signature</p>
                );
              }}
            />
          </div>
          <div className="space-y-4">
            <Card title="Client responses" bodyClassName="px-4 py-0">
              {doc.actions.length ? (
                <ul className="divide-y divide-line">
                  {doc.actions.map((a) => (
                    <ActionRow key={a.id} a={a} blocks={doc.blocks} />
                  ))}
                </ul>
              ) : (
                <Empty title="No response yet" description="The client sees this document in their portal." />
              )}
            </Card>
            <Card title="Record">
              <p className="text-xs text-mute">Published content is locked. Every client action is stored with this content fingerprint:</p>
              <p className="mt-2 font-mono text-[11px] break-all text-faint">{doc.content_hash}</p>
              <p className="mt-3 text-xs text-mute">Need changes? Create a new draft from the project’s Documents tab.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
