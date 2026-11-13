'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Bell, Mail, MoreHorizontal, Pencil, XCircle } from 'lucide-react';
import { get, post, patch } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Field, Menu, Modal, useConfirm, useToast, type Tone } from '@/components/ui';
import { formErrors, fromLocalInput, newId, toLocalInput } from './util';
import { splitTarget, useTargets, type TargetValue } from './useTargets';
import { TargetSelect } from './TargetSelect';

export interface Reminder {
  id: string;
  title: string;
  body: string;
  run_at: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled' | 'skipped';
  channel: 'in_app' | 'email';
  recipient_id: string;
  recipient_name: string;
  created_by: string;
  created_by_name: string;
  type_id: string | null;
  type_label: string | null;
  project_id: string | null;
  project_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  last_error?: string;
  auto_notice?: boolean;
}

interface Recipient {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface ReminderType {
  id: string;
  label: string;
}

const STATUS: Record<Reminder['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Scheduled', tone: 'acc' },
  sent: { label: 'Delivered', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export function reminderStatus(r: Reminder) {
  return STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone };
}

export function reminderTarget(r: Reminder): { label: string; href: string } | null {
  if (r.meeting_id) return { label: `Meeting · ${r.meeting_title ?? ''}`, href: `/meetings/${r.meeting_id}` };
  if (r.project_id) return { label: `Project · ${r.project_name ?? ''}`, href: `/projects/${r.project_id}` };
  if (r.lead_id) return { label: `Lead · ${r.lead_name ?? ''}`, href: `/leads/${r.lead_id}` };
  return null;
}

function defaultRunAt() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d.toISOString());
}

/**
 * Create or edit a reminder. When `fixed` is given the reminder is tied to that
 * meeting/lead/project and the target picker is hidden.
 */
export function ReminderModal({
  open,
  onClose,
  reminder,
  onSaved,
  fixed,
}: {
  open: boolean;
  onClose: () => void;
  reminder?: Reminder | null;
  onSaved: (r: Reminder) => void;
  fixed?: { meetingId?: string; leadId?: string; projectId?: string; label?: string };
}) {
  const { user } = useSession();
  const toast = useToast();
  const targets = useTargets();
  const editing = !!reminder;
  const [types, setTypes] = useState<ReminderType[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [form, setForm] = useState({ id: '', title: '', body: '', runAt: '', recipientId: '', typeId: '', channel: 'in_app' as 'in_app' | 'email', target: '' as TargetValue });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setGeneral('');
    setForm(
      reminder
        ? {
            id: reminder.id,
            title: reminder.title,
            body: reminder.body,
            runAt: toLocalInput(reminder.run_at),
            recipientId: reminder.recipient_id,
            typeId: reminder.type_id ?? '',
            channel: reminder.channel,
            target: reminder.project_id ? `project:${reminder.project_id}` : reminder.lead_id ? `lead:${reminder.lead_id}` : '',
          }
        : { id: newId(), title: '', body: '', runAt: defaultRunAt(), recipientId: user?.id ?? '', typeId: '', channel: 'in_app', target: '' },
    );
    get<ReminderType[]>('/reminder-types').then(setTypes, () => setTypes([]));
  }, [open, reminder, user]);

  const projectId = fixed?.projectId ?? reminder?.project_id ?? splitTarget(form.target).projectId;
  useEffect(() => {
    if (!open) return;
    get<Recipient[]>(`/reminders/recipients${projectId ? `?projectId=${projectId}` : ''}`).then(setRecipients, () => setRecipients([]));
  }, [open, projectId]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local.title = 'Add a subject.';
    const runAt = fromLocalInput(form.runAt);
    if (!runAt) local.runAt = 'Choose when to send it.';
    else if (new Date(runAt).getTime() < Date.now() - 60_000) local.runAt = 'Choose a time in the future.';
    if (!form.recipientId) local.recipientId = 'Choose who receives it.';
    if (!editing && !fixed && !form.target) local.target = 'Link the reminder to a lead or project.';
    if (Object.keys(local).length) return setErrors(local);
    setSaving(true);
    setGeneral('');
    try {
      const common = { title: form.title.trim(), body: form.body.trim(), runAt, recipientId: form.recipientId, typeId: form.typeId || null };
      let saved: Reminder;
      if (reminder) saved = await patch<Reminder>(`/reminders/${reminder.id}`, common);
      else {
        const t = fixed ?? splitTarget(form.target);
        saved = await post<Reminder>('/reminders', {
          ...common,
          id: form.id,
          channel: form.channel,
          projectId: t.projectId ?? null,
          leadId: t.leadId ?? null,
          meetingId: fixed?.meetingId ?? null,
        });
      }
      toast.success(editing ? 'Reminder updated' : 'Reminder scheduled');
      onSaved(saved);
      onClose();
    } catch (err) {
      const f = formErrors(err, ['title', 'body', 'runAt', 'recipientId', 'typeId']);
      setErrors(f.fields);
      setGeneral(f.general);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit reminder' : 'New reminder'}
      description={fixed?.label}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reminder-form" loading={saving}>
            {editing ? 'Save changes' : 'Schedule'}
          </Button>
        </>
      }
    >
      <form id="reminder-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{general}</p>}
        <Field label="Subject" required error={errors.title}>
          <input className="input" value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="Follow up on the proposal" />
        </Field>
        {!fixed && (
          <Field label="About" required={!editing} error={errors.target} hint={editing ? 'The linked record cannot be changed.' : undefined}>
            <TargetSelect targets={targets} value={form.target} onChange={(v) => set('target', v)} disabled={editing} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send at" required error={errors.runAt}>
            <input type="datetime-local" className="input" value={form.runAt} onChange={(e) => set('runAt', e.target.value)} />
          </Field>
          <Field label="Recipient" required error={errors.recipientId}>
            <select className="input" value={form.recipientId} onChange={(e) => set('recipientId', e.target.value)}>
              <option value="">Choose…</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.id === user?.id ? ' (you)' : r.role === 'client' ? ' · client' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type" error={errors.typeId}>
            <select className="input" value={form.typeId} onChange={(e) => set('typeId', e.target.value)}>
              <option value="">General</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Delivery" hint={editing ? 'Delivery channel is fixed once scheduled.' : undefined}>
            <select className="input" value={form.channel} disabled={editing} onChange={(e) => set('channel', e.target.value as 'in_app' | 'email')}>
              <option value="in_app">In-app notification</option>
              <option value="email">Email</option>
            </select>
          </Field>
        </div>
        <Field label="Note" error={errors.body}>
          <textarea className="input min-h-24" value={form.body} maxLength={5000} onChange={(e) => set('body', e.target.value)} placeholder="Optional details for the recipient" />
        </Field>
      </form>
    </Modal>
  );
}

/** One reminder row with edit/cancel for its creator. */
export function ReminderRow({
  reminder: r,
  onChange,
  onEdit,
  showTarget = true,
}: {
  reminder: Reminder;
  onChange: (r: Reminder) => void;
  onEdit?: (r: Reminder) => void;
  showTarget?: boolean;
}) {
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const s = reminderStatus(r);
  const target = reminderTarget(r);
  const editable = r.created_by === user?.id && (r.status === 'pending' || r.status === 'failed') && !r.auto_notice;

  const cancel = async () => {
    if (!(await confirm({ title: 'Cancel this reminder?', description: r.title, confirmLabel: 'Cancel reminder', danger: true }))) return;
    try {
      onChange(await post<Reminder>(`/reminders/${r.id}/cancel`));
      toast.success('Reminder cancelled');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acc-soft text-acc">
        {r.channel === 'email' ? <Mail className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={r.status === 'cancelled' ? 'text-sm font-medium text-mute line-through' : 'text-sm font-medium'}>{r.title}</p>
          <Badge tone={s.tone}>{s.label}</Badge>
          {r.type_label && <Badge>{r.type_label}</Badge>}
        </div>
        {r.body && <p className="mt-0.5 line-clamp-2 text-sm text-mute">{r.body}</p>}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-mute">
          <span title={new Date(r.run_at).toLocaleString()}>
            {dateTime(r.run_at)} · {relative(r.run_at)}
          </span>
          <span>To {r.recipient_id === user?.id ? 'you' : r.recipient_name}</span>
          {r.created_by !== user?.id && <span>From {r.created_by_name}</span>}
          {showTarget && target && (
            <Link href={target.href} className="hover:text-ink hover:underline">
              {target.label}
            </Link>
          )}
        </div>
        {r.status === 'failed' && r.last_error && <p className="mt-1 text-xs text-danger">{r.last_error}</p>}
      </div>
      {editable && (
        <Menu
          trigger={(open) => (
            <Button variant="ghost" size="icon" onClick={open} aria-label={`Actions for ${r.title}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          )}
          items={[
            ...(onEdit ? [{ label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit(r) }] : []),
            { label: 'Cancel reminder', icon: <XCircle className="h-4 w-4" />, danger: true, onSelect: cancel },
          ]}
        />
      )}
    </div>
  );
}
