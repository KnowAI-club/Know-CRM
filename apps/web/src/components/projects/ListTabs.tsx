'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, FileText, Plus, Receipt } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { date, dateTime, money, relative, titleCase } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, Modal, useToast } from '@/components/ui';
import { MeetingModal } from '@/components/work/meetings';
import type { Activity, DocKind, DocumentRow, InvoiceView, MeetingRow } from './types';
import { DOC_KIND_LABEL, INVOICE_TONE, fieldErrors } from './util';

export function MeetingsTab({ projectId, meetings }: { projectId: string; meetings: MeetingRow[] }) {
  const router = useRouter();
  const [scheduling, setScheduling] = useState(false);
  const [now] = useState(() => Date.now());
  const upcoming = meetings.filter((m) => new Date(m.start_at).getTime() >= now && m.status !== 'cancelled').reverse();
  const past = meetings.filter((m) => !upcoming.includes(m));
  const row = (m: MeetingRow) => (
    <li key={m.id}>
      <Link href={`/meetings/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{m.title}</p>
          <p className="text-xs text-mute">
            {dateTime(m.start_at)} · {m.duration_minutes} min · {titleCase(m.kind)}
          </p>
        </div>
        {m.sharing === 'client' && <Badge tone="info">Client</Badge>}
        {m.status === 'cancelled' ? (
          <Badge tone="danger">Cancelled</Badge>
        ) : m.outcome ? (
          <Badge tone="ok">{titleCase(m.outcome)}</Badge>
        ) : null}
      </Link>
    </li>
  );
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setScheduling(true)}>
          <CalendarDays className="h-4 w-4" /> Schedule meeting
        </Button>
      </div>
      <MeetingModal
        open={scheduling}
        onClose={() => setScheduling(false)}
        defaultTarget={`project:${projectId}`}
        onSaved={(m) => router.push(`/meetings/${m.id}`)}
      />
      <Card title={`Upcoming (${upcoming.length})`} bodyClassName="p-0">
        {upcoming.length ? <ul className="divide-y divide-line">{upcoming.map(row)}</ul> : <Empty title="Nothing scheduled" />}
      </Card>
      {past.length > 0 && (
        <Card title={`Past (${past.length})`} bodyClassName="p-0">
          <ul className="divide-y divide-line">{past.map(row)}</ul>
        </Card>
      )}
    </div>
  );
}

interface Template {
  id: string;
  name: string;
  kind: DocKind;
}

export function DocumentsTab({ projectId, documents }: { projectId: string; documents: DocumentRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data: templates } = useLoad((s) => (open ? get<Template[]>('/document-templates', s) : Promise.resolve(undefined)), [open]);
  const [form, setForm] = useState({ templateId: '', title: '', kind: 'proposal' as DocKind });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!form.templateId && !form.title.trim()) return setErrors({ title: 'Add a title.' });
    setSaving(true);
    try {
      const body = form.templateId
        ? { templateId: form.templateId, title: form.title || undefined }
        : {
            title: form.title,
            kind: form.kind,
            blocks: [{ id: `b_${Date.now().toString(36)}`, type: 'heading', text: form.title, level: 1 }],
          };
      const doc = await post<DocumentRow>(`/projects/${projectId}/documents`, body);
      router.push(`/documents/${doc.id}`);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.error(e);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New document
        </Button>
      </div>
      <Card title={`Documents (${documents.length})`} bodyClassName="p-0">
        {!documents.length ? (
          <Empty
            icon={<FileText className="h-5 w-5" />}
            title="No documents"
            description="Send proposals, contracts and questionnaires through the client portal."
          />
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((d) => (
              <li key={d.id}>
                <Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-mute">
                      {DOC_KIND_LABEL[d.kind]} · updated {relative(d.updated_at)}
                    </p>
                  </div>
                  <Badge tone={d.status === 'published' ? 'ok' : 'neutral'}>{d.status === 'published' ? 'Published' : 'Draft'}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New document"
        description="Start from a template or a blank draft. Drafts stay private until you publish."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving}>
              Create draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Template" error={errors.templateId}>
            <select className="input" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
              <option value="">Blank document</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({DOC_KIND_LABEL[t.kind]})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" error={errors.title} hint={form.templateId ? 'Leave blank to use the template name.' : undefined}>
            <input className="input" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          {!form.templateId && (
            <Field label="Type" error={errors.kind}>
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as DocKind })}>
                {Object.entries(DOC_KIND_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}

export function InvoicesTab({ projectId, invoices, currency }: { projectId: string; invoices: InvoiceView[]; currency: string }) {
  const total = invoices.filter((i) => i.status !== 'void').reduce((a, i) => a + i.total, 0);
  const balance = invoices.filter((i) => i.status !== 'void' && i.status !== 'draft').reduce((a, i) => a + i.balance, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-sm text-mute">
          Billed <span className="font-semibold text-ink tabular-nums">{money(total, currency)}</span> · Outstanding{' '}
          <span className="font-semibold text-ink tabular-nums">{money(balance, currency)}</span>
        </p>
        <Link href={`/invoices/new?projectId=${projectId}`} className="ml-auto">
          <Button>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        </Link>
      </div>
      <Card bodyClassName="p-0">
        {!invoices.length ? (
          <Empty
            icon={<Receipt className="h-5 w-5" />}
            title="No invoices"
            description="Raise GST invoices with part payments and instalments."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                        {i.number || 'Draft'}
                      </Link>
                      <p className="text-xs text-mute">{i.title}</p>
                    </td>
                    <td>
                      <Badge tone={INVOICE_TONE[i.status] ?? 'neutral'}>{titleCase(i.status)}</Badge>
                    </td>
                    <td className="text-mute">{date(i.next_payment_due || i.due_date)}</td>
                    <td className="text-right tabular-nums">{money(i.total, i.currency)}</td>
                    <td className="text-right tabular-nums">{money(i.balance, i.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ActivityTab({ activity }: { activity: Activity[] }) {
  const [scope, setScope] = useState<'all' | 'client'>('all');
  const shown = activity.filter((a) => scope === 'all' || a.visibility === 'client');
  return (
    <Card
      title="Activity"
      action={
        <select
          className="input h-8 w-auto py-0 text-xs"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'all' | 'client')}
          aria-label="Activity scope"
        >
          <option value="all">Everything</option>
          <option value="client">Client-visible only</option>
        </select>
      }
    >
      {!shown.length ? (
        <Empty title="No activity yet" />
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {shown.map((a) => (
            <li key={a.id} className="relative">
              <span
                className={`absolute top-1.5 -left-[23.5px] h-2 w-2 rounded-full ${a.visibility === 'client' ? 'bg-info' : 'bg-faint'}`}
                aria-hidden
              />
              <p className="text-sm">{a.description}</p>
              <p className="text-xs text-faint">
                {a.actor_name} · <span title={new Date(a.created_at).toLocaleString()}>{relative(a.created_at)}</span>
                {a.visibility === 'client' && ' · visible to client'}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
