'use client';
import { useRef, useState } from 'react';
import { FileText, Mail, Plus, Trash2 } from 'lucide-react';
import { MERGE_FIELDS } from '@know-crm/shared';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs, useConfirm, useToast } from '@/components/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { fieldErrors } from '@/components/money/util';
import { BlocksEditor, cleanBlocks, newBlock, validateBlocks, type Block } from '@/components/settings/BlocksEditor';

interface EmailTemplate {
  id: string;
  grp: 'EM';
  title: string;
  subject: string;
  body: string;
  updated_at: string;
}
interface DocTemplate {
  id: string;
  name: string;
  kind: 'proposal' | 'contract' | 'questionnaire';
  blocks: Block[];
  version: number;
  updated_at: string;
}

const GROUP_LABEL = { EM: 'Sales emails' } as const;

export default function TemplatesPage() {
  const [tab, setTab] = useState<'email' | 'documents'>('email');
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Templates"
        description="Reusable email copy and document starting points for proposals, contracts and questionnaires."
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'email', label: 'Email templates' },
          { value: 'documents', label: 'Document templates' },
        ]}
      />
      {tab === 'email' ? <EmailTemplates /> : <DocumentTemplates />}
    </>
  );
}

/* ───────────── Email templates ───────────── */

function EmailTemplates() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useLoad((s) => get<EmailTemplate[]>('/email-templates', s), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<'EM' | null>(null);
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />;
  if (!list.data) return <Spinner />;
  const current = list.data.find((t) => t.id === selected) ?? list.data[0] ?? null;

  const remove = async (t: EmailTemplate) => {
    if (
      !(await confirm({
        title: `Delete “${t.title}”?`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/email-templates/${t.id}`);
      list.setData((l) => l?.filter((x) => x.id !== t.id));
      setSelected(null);
      toast.success('Template deleted.');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card bodyClassName="p-0">
        {(['EM'] as const).map((g) => (
          <div key={g} className="border-b border-line last:border-b-0">
            <div className="flex items-center px-4 pt-3 pb-1">
              <p className="eyebrow flex-1">{GROUP_LABEL[g]}</p>
              <Button size="sm" variant="ghost" onClick={() => setCreating(g)} aria-label={`New ${GROUP_LABEL[g]} template`}>
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
            <ul className="px-2 pb-2">
              {list
                .data!.filter((t) => t.grp === g)
                .map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelected(t.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                        current?.id === t.id ? 'bg-acc-soft text-acc' : 'hover:bg-subtle',
                      )}
                    >
                      <span className="w-12 shrink-0 text-xs text-faint">{t.id}</span>
                      <span className="truncate">{t.title}</span>
                    </button>
                  </li>
                ))}
              {!list.data!.some((t) => t.grp === g) && <li className="px-2.5 py-2 text-sm text-faint">No templates</li>}
            </ul>
          </div>
        ))}
      </Card>
      {current ? (
        <EmailEditor
          key={current.id + current.updated_at}
          template={current}
          onSaved={(t) => list.setData((l) => l?.map((x) => (x.id === t.id ? t : x)))}
          onDelete={() => remove(current)}
        />
      ) : (
        <Card>
          <Empty icon={<Mail className="h-5 w-5" />} title="No email templates" description="Create one to reuse copy across leads." />
        </Card>
      )}
      {creating && (
        <NewEmailModal
          group={creating}
          onClose={() => setCreating(null)}
          onSaved={(t) => {
            list.setData((l) => [...(l ?? []), t]);
            setSelected(t.id);
            setCreating(null);
          }}
        />
      )}
    </div>
  );
}

function MergeFieldHelp({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div>
      <p className="label">Merge fields · click to insert</p>
      <div className="flex flex-wrap gap-1.5">
        {MERGE_FIELDS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onInsert(`{{${f}}}`)}
            className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-xs text-mute hover:bg-acc-soft hover:text-acc"
          >
            {`{{${f}}}`}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-faint">Formatting: **bold**, *italic*, [link text](https://…). Blank lines start new paragraphs.</p>
    </div>
  );
}

function EmailEditor({
  template,
  onSaved,
  onDelete,
}: {
  template: EmailTemplate;
  onSaved: (t: EmailTemplate) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(template.title);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = title !== template.title || subject !== template.subject || body !== template.body;

  const insert = (token: string) => {
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const save = async () => {
    if (!title.trim()) return setError('Enter a template name.');
    setError('');
    setSaving(true);
    try {
      onSaved(
        await patch<EmailTemplate>(`/email-templates/${template.id}`, {
          title: title.trim(),
          subject,
          body,
        }),
      );
      toast.success('Template saved.');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {template.title} <Badge>{template.id}</Badge>
        </span>
      }
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete template">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={error}>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Subject">
          <input className="input" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Body">
          <textarea
            ref={bodyRef}
            className="input font-mono text-[13px]"
            rows={12}
            value={body}
            maxLength={50000}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <MergeFieldHelp onInsert={insert} />
        <p className="text-xs text-faint">
          Updated {relative(template.updated_at)}. Templates are copied by hand or into sequences; nothing here sends email.
        </p>
      </div>
    </Card>
  );
}

function NewEmailModal({ group, onClose, onSaved }: { group: 'EM'; onClose: () => void; onSaved: (t: EmailTemplate) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErrors({ title: 'Enter a template name.' });
    setSaving(true);
    try {
      onSaved(
        await post<EmailTemplate>('/email-templates', {
          group,
          title: title.trim(),
          subject,
          body: '',
        }),
      );
      toast.success('Template created.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`New ${GROUP_LABEL[group].toLowerCase().replace(/s$/, '')} template`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-email" loading={saving}>
            Create
          </Button>
        </>
      }
    >
      <form id="new-email" onSubmit={submit} className="space-y-4">
        <Field label="Name" required error={errors.title}>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Subject">
          <input className="input" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ───────────── Document templates ───────────── */

const KIND_LABEL = {
  proposal: 'Proposal',
  contract: 'Contract',
  questionnaire: 'Questionnaire',
} as const;

function DocumentTemplates() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useLoad((s) => get<DocTemplate[]>('/document-templates', s), []);
  const [editing, setEditing] = useState<DocTemplate | 'new' | null>(null);
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />;
  if (!list.data) return <Spinner />;

  const remove = async (t: DocTemplate) => {
    if (
      !(await confirm({
        title: `Delete “${t.name}”?`,
        description: 'Draft documents made from it keep their content.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/document-templates/${t.id}`);
      list.setData((l) => l?.filter((x) => x.id !== t.id));
      toast.success('Template deleted.');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> New template
        </Button>
      </div>
      {list.data.length === 0 ? (
        <Card>
          <Empty
            icon={<FileText className="h-5 w-5" />}
            title="No document templates"
            description="Save a proposal, contract or questionnaire layout to start new project documents faster."
            action={<Button onClick={() => setEditing('new')}>New template</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((t) => (
            <div key={t.id} className="card flex flex-col p-4">
              <div className="flex items-start gap-2">
                <button className="flex-1 text-left font-medium hover:underline" onClick={() => setEditing(t)}>
                  {t.name}
                </button>
                <Badge tone="acc">{KIND_LABEL[t.kind]}</Badge>
              </div>
              <p className="mt-1 flex-1 text-sm text-mute">
                {t.blocks.length} block{t.blocks.length === 1 ? '' : 's'} · v{t.version} · updated {relative(t.updated_at)}
              </p>
              <div className="mt-3 flex gap-2 border-t border-line pt-3">
                <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(t)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <DocTemplateModal
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            list.setData((l) => [t, ...(l ?? []).filter((x) => x.id !== t.id)]);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function DocTemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: DocTemplate | null;
  onClose: () => void;
  onSaved: (t: DocTemplate) => void;
}) {
  const toast = useToast();
  const { currency } = useSession();
  const [name, setName] = useState(template?.name ?? '');
  const [kind, setKind] = useState<DocTemplate['kind']>(template?.kind ?? 'proposal');
  const [blocks, setBlocks] = useState<Block[]>(
    template?.blocks ?? [{ ...newBlock('heading', currency), text: 'Proposal', level: 1 } as Block, newBlock('text', currency)],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const errs: Record<string, string> = validateBlocks(blocks);
    if (!name.trim()) errs.name = 'Name the template.';
    if (!blocks.length) errs.blocks = 'Add at least one block.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), kind, blocks: cleanBlocks(blocks) };
      const saved = template
        ? await patch<DocTemplate>(`/document-templates/${template.id}`, body)
        : await post<DocTemplate>('/document-templates', body);
      toast.success('Template saved.');
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        const f = fieldErrors(e);
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(f)) {
          const m = /^blocks\.(\d+)/.exec(k);
          if (m && blocks[Number(m[1])]) mapped[blocks[Number(m[1])]!.id] = v;
          else mapped[k] = v;
        }
        setErrors(mapped);
      }
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={template ? 'Edit document template' : 'New document template'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Name" required error={errors.name}>
            <input className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DocTemplate['kind'])}>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <BlocksEditor blocks={blocks} onChange={setBlocks} currency={currency} errors={errors} />
        {errors.blocks && <p className="text-xs text-danger">{errors.blocks}</p>}
      </div>
    </Modal>
  );
}
