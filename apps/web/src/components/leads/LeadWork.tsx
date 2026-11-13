'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Download, FileText, Paperclip, Pencil, Plus, Trash2, Video } from 'lucide-react';
import { MEETING_OUTCOME_LABELS } from '@know-crm/shared';
import { api, del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { bytes, date, dateTime, relative, titleCase, today } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  MentionText,
  MentionTextarea,
  Modal,
  Skeleton,
  useConfirm,
  useToast,
} from '@/components/ui';
import { OwnerSelect } from './OwnerSelect';
import { fieldErrors, type Lead } from './types';

const Loading = () => (
  <div className="space-y-2">
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

/* ── Meetings ─────────────────────────────────────────────────────────────── */

export interface LeadMeeting {
  id: string;
  title: string;
  kind: string;
  start_at: string;
  duration_minutes: number;
  status: string;
  outcome: string | null;
  source: string;
}

export function LeadMeetings({ lead, meetings, onCreated }: { lead: Lead; meetings: LeadMeeting[]; onCreated: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', kind: 'video', start: '', duration: 30, meetingUrl: '', location: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canSchedule = lead.state === 'active';
  const [now] = useState(() => Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local.title = 'Add a title.';
    if (!form.start) local.startAt = 'Choose a start time.';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      await post('/meetings', {
        leadId: lead.id,
        title: form.title.trim(),
        kind: form.kind,
        startAt: new Date(form.start).toISOString(),
        durationMinutes: Number(form.duration),
        meetingUrl: form.meetingUrl.trim(),
        location: form.location.trim(),
        externalEmails: [lead.email],
      });
      toast.success('Meeting scheduled');
      setOpen(false);
      setForm({ title: '', kind: 'video', start: '', duration: 30, meetingUrl: '', location: '' });
      onCreated();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {canSchedule && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => (setForm((f) => ({ ...f, title: f.title || `Call · ${lead.name}` })), setOpen(true))}>
            <CalendarPlus className="h-3.5 w-3.5" /> Schedule meeting
          </Button>
        </div>
      )}
      {meetings.length === 0 ? (
        <Empty
          title="No meetings yet"
          description="Discovery calls and follow-ups with this lead appear here."
          icon={<Video className="h-5 w-5" />}
        />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {meetings.map((m) => {
            const upcoming = new Date(m.start_at).getTime() > now && m.status !== 'cancelled';
            return (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-subtle">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-mute">
                      {dateTime(m.start_at)} · {m.duration_minutes} min · {titleCase(m.kind)}
                    </p>
                  </div>
                  {m.status === 'cancelled' ? (
                    <Badge tone="danger">Cancelled</Badge>
                  ) : m.outcome ? (
                    <Badge tone={m.outcome === 'attended' ? 'ok' : 'warn'}>{MEETING_OUTCOME_LABELS[m.outcome] ?? m.outcome}</Badge>
                  ) : upcoming ? (
                    <Badge tone="info">Upcoming</Badge>
                  ) : (
                    <Badge tone="warn">Record outcome</Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule meeting"
        description={`${lead.email} is invited as a guest.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="lead-meeting" loading={saving}>
              Schedule
            </Button>
          </>
        }
      >
        <form id="lead-meeting" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Title" required error={errors.title} className="sm:col-span-2">
            <input className="input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Starts" required error={errors.startAt}>
            <input
              className="input"
              type="datetime-local"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Duration (minutes)" error={errors.durationMinutes}>
            <input
              className="input"
              type="number"
              min={5}
              max={480}
              step={5}
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}
            />
          </Field>
          <Field label="Type">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="video">Video call</option>
              <option value="phone">Phone</option>
              <option value="in_person">In person</option>
            </select>
          </Field>
          {form.kind === 'in_person' ? (
            <Field label="Location" error={errors.location}>
              <input
                className="input"
                maxLength={500}
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </Field>
          ) : (
            <Field label="Meeting link" error={errors.meetingUrl}>
              <input
                className="input"
                type="url"
                placeholder="https://"
                maxLength={1000}
                value={form.meetingUrl}
                onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
              />
            </Field>
          )}
        </form>
      </Modal>
    </div>
  );
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

interface Task {
  id: string;
  title: string;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  urgent: boolean;
  completed: boolean;
}

export function LeadTasks({ lead }: { lead: Lead }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Task[]>(`/leads/${lead.id}/tasks`, s), [lead.id]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = lead.state === 'won';

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const t = await post<Task>(`/leads/${lead.id}/tasks`, { title: title.trim(), dueDate: due || null, assigneeId: assignee, urgent });
      setData((cur) => [...(cur ?? []), t]);
      setTitle('');
      setDue('');
      setUrgent(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: Task) => {
    setData((cur) => cur?.map((x) => (x.id === t.id ? { ...x, completed: !t.completed } : x)));
    try {
      await patch(`/tasks/${t.id}`, { completed: !t.completed });
    } catch (err) {
      toast.error(err);
      void reload();
    }
  };

  const remove = async (t: Task) => {
    if (!(await confirm({ title: 'Delete task?', description: t.title, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/tasks/${t.id}`);
      setData((cur) => cur?.filter((x) => x.id !== t.id));
    } catch (err) {
      toast.error(err);
    }
  };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  const tasks = data ?? [];
  const todayIso = today();

  return (
    <div className="space-y-4">
      {!locked && (
        <form
          onSubmit={add}
          className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-center"
        >
          <input
            className="input"
            placeholder="Add a task…"
            aria-label="Task title"
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input className="input sm:w-40" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="sm:w-40">
            <OwnerSelect value={assignee} onChange={setAssignee} emptyLabel="No assignee" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-mute">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
          </label>
          <Button type="submit" size="sm" loading={saving} disabled={!title.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </form>
      )}
      {tasks.length === 0 ? (
        <Empty title="No tasks" description={locked ? 'Open tasks moved to the project on close won.' : 'Plan the next follow-up here.'} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {tasks.map((t) => {
            const overdue = !t.completed && t.due_date && t.due_date < todayIso;
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--acc)]"
                  checked={t.completed}
                  disabled={locked}
                  onChange={() => void toggle(t)}
                  aria-label={`Mark ${t.title} ${t.completed ? 'open' : 'done'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', t.completed && 'text-mute line-through')}>{t.title}</p>
                  <p className="text-xs text-mute">
                    {t.assignee_name ?? 'Unassigned'}
                    {t.due_date && <span className={cn(overdue && 'font-medium text-danger')}> · due {date(t.due_date)}</span>}
                  </p>
                </div>
                {t.urgent && !t.completed && <Badge tone="danger">Urgent</Badge>}
                {!locked && (
                  <Button size="icon" variant="ghost" onClick={() => void remove(t)} aria-label="Delete task">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Files & comments ─────────────────────────────────────────────────────── */

interface Attachment {
  id: string;
  title: string;
  name: string;
  size: number;
  mime: string;
  file_type: string | null;
  created_at: string;
}
interface FileType {
  id: string;
  label: string;
}
interface Comment {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export function LeadFiles({ lead, attachments, onChanged }: { lead: Lead; attachments: Attachment[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const types = useLoad((s) => get<FileType[]>('/file-types', s), []);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [typeId, setTypeId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const locked = lead.state === 'won';

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Add a title.');
    if (!typeId) return setError('Choose a file type.');
    if (!files.length) return setError('Choose at least one file.');
    const body = new FormData();
    body.set('title', title.trim());
    body.set('fileTypeId', typeId);
    files.forEach((f) => body.append('files', f));
    setSaving(true);
    try {
      await api(`/leads/${lead.id}/attachments`, { method: 'POST', body });
      toast.success(files.length > 1 ? `${files.length} files uploaded` : 'File uploaded');
      setOpen(false);
      setTitle('');
      setFiles([]);
      setError('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Attachment) => {
    if (!(await confirm({ title: 'Delete file?', description: a.name, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/lead-attachments/${a.id}`);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold">Files</h3>
          {!locked && (
            <Button size="sm" variant="secondary" onClick={() => (setTypeId((t) => t || types.data?.[0]?.id || ''), setOpen(true))}>
              <Paperclip className="h-3.5 w-3.5" /> Upload
            </Button>
          )}
        </div>
        {attachments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mute">
            No files yet. Attach briefs, proposals or call recordings.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-mute" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="truncate text-xs text-mute">
                    {a.name} · {bytes(Number(a.size))} · {relative(a.created_at)}
                  </p>
                </div>
                {a.file_type && <Badge>{a.file_type}</Badge>}
                <a
                  href={`/api/lead-attachments/${a.id}/download`}
                  className="rounded-md p-1.5 text-mute hover:bg-subtle hover:text-ink"
                  aria-label={`Download ${a.name}`}
                >
                  <Download className="h-4 w-4" />
                </a>
                {!locked && (
                  <Button size="icon" variant="ghost" onClick={() => void remove(a)} aria-label={`Delete ${a.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <LeadComments lead={lead} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Upload files"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="lead-upload" loading={saving}>
              Upload
            </Button>
          </>
        }
      >
        <form id="lead-upload" onSubmit={upload} className="space-y-4" noValidate>
          <Field label="Title" required>
            <input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="File type" required>
            <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Choose…</option>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <p className="label">Files (up to 10)</p>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="w-full rounded-xl border border-dashed border-line px-4 py-6 text-sm text-mute hover:border-acc/50 hover:text-ink"
            >
              {files.length ? files.map((f) => f.name).join(', ') : 'Choose files'}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
            />
          </div>
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}

function LeadComments({ lead }: { lead: Lead }) {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Comment[]>(`/leads/${lead.id}/comments`, s), [lead.id]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const locked = lead.state === 'won';

  const send = async () => {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const c = await post<Comment>(`/leads/${lead.id}/comments`, { body: body.trim() });
      setData((cur) => [c, ...(cur ?? [])]);
      setBody('');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">Comments</h3>
      {!locked && (
        <div className="mb-4 space-y-2">
          <MentionTextarea value={body} onChange={setBody} onSubmit={send} />
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-faint">⌘/Ctrl + Enter to post</span>
            <Button size="sm" onClick={send} loading={saving} disabled={!body.trim()}>
              Post comment
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <p className="text-sm text-mute">No comments yet.</p>
      ) : (
        <ul className="space-y-4">
          {data.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.author_name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-mute">
                  <span className="font-medium text-ink">{c.author_name}</span> · {relative(c.created_at)}
                </p>
                <MentionText text={c.body} className="mt-0.5 block text-sm" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Notes ────────────────────────────────────────────────────────────────── */

interface Note {
  id: string;
  title: string;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export function LeadNotes({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useLoad((s) => get<Note[]>(`/leads/${lead.id}/notes`, s), [lead.id]);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const start = (n: Note | 'new') => {
    setEditing(n);
    setTitle(n === 'new' ? '' : n.title);
    setBody(n === 'new' ? '' : n.body);
    setErrors({});
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErrors({ title: 'Add a title.' });
    setSaving(true);
    try {
      if (editing === 'new') await post(`/leads/${lead.id}/notes`, { title: title.trim(), body });
      else if (editing) await patch(`/lead-notes/${editing.id}`, { title: title.trim(), body });
      setEditing(null);
      void reload();
      onChanged();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: Note) => {
    if (!(await confirm({ title: 'Delete note?', description: n.title, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/lead-notes/${n.id}`);
      void reload();
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => start('new')}>
          <Plus className="h-3.5 w-3.5" /> New note
        </Button>
      </div>
      {!data?.length ? (
        <Empty title="No notes" description="Capture call notes, pricing discussions and context for the team." />
      ) : (
        data.map((n) => (
          <article key={n.id} className="rounded-xl border border-line p-4">
            <header className="mb-1 flex items-start gap-2">
              <h4 className="flex-1 text-sm font-semibold">{n.title}</h4>
              <Button size="icon" variant="ghost" onClick={() => start(n)} aria-label="Edit note">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => void remove(n)} aria-label="Delete note">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </header>
            {n.body && <p className="text-sm whitespace-pre-wrap">{n.body}</p>}
            <p className="mt-2 text-xs text-faint">
              {n.author_name} · {dateTime(n.created_at)}
              {n.updated_at !== n.created_at && ` · edited ${relative(n.updated_at)}`}
            </p>
          </article>
        ))
      )}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New note' : 'Edit note'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="lead-note" loading={saving}>
              Save note
            </Button>
          </>
        }
      >
        <form id="lead-note" onSubmit={save} className="space-y-4" noValidate>
          <Field label="Title" required error={errors.title}>
            <input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Note" error={errors.body}>
            <textarea className="input" rows={8} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

/* ── History & cycle ──────────────────────────────────────────────────────── */

export interface HistoryEntry {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_name: string;
}

const ACTION_LABELS: Record<string, string> = {
  exit: 'Exited the pipeline',
  archive: 'Archived',
  restore: 'Back to pipeline',
  won: 'Closed won',
};

export function LeadHistory({ history, stageLabel }: { history: HistoryEntry[]; stageLabel: (id: string) => string }) {
  if (!history.length) return <Empty title="No history yet" />;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {history.map((h) => {
        const d = h.detail ?? {};
        const extra: string[] = [];
        if (typeof d.previousStage === 'string' && typeof d.stage === 'string')
          extra.push(`${stageLabel(d.previousStage)} → ${stageLabel(d.stage)}`);
        if (Array.isArray(d.fields) && d.fields.length) extra.push(`Changed: ${(d.fields as string[]).map(titleCase).join(', ')}`);
        if (typeof d.reason === 'string' && d.reason) extra.push(d.reason);
        return (
          <li key={h.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] h-2 w-2 rounded-full bg-acc" />
            <p className="text-sm font-medium">{ACTION_LABELS[h.action] ?? h.action}</p>
            {extra.map((x, i) => (
              <p key={i} className="text-sm whitespace-pre-wrap text-mute">
                {x}
              </p>
            ))}
            <p className="text-xs text-faint">
              {h.actor_name} · {dateTime(h.created_at)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

interface Cycle {
  createdAt: string;
  wonAt: string | null;
  segments: { stage: string; start: string; end: string }[];
}

const days = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
const fmtDays = (n: number) => (n < 1 ? '<1 day' : `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`);

/** Time spent in each stage across the lead's life. */
export function LeadCycle({
  leadId,
  version,
  stageLabel,
  stageColor,
}: {
  leadId: string;
  version: number;
  stageLabel: (id: string) => string;
  stageColor: (id: string) => string;
}) {
  const { data, error } = useLoad((s) => get<Cycle>(`/leads/${leadId}/cycle`, s), [leadId, version]);
  if (error) return null;
  return (
    <Card title="Sales cycle">
      {!data ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        (() => {
          const total = days(data.createdAt, data.wonAt ?? new Date().toISOString());
          return (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="text-2xl font-semibold">{fmtDays(total)}</span>
                <span className="ml-1 text-mute">{data.wonAt ? 'to close' : 'since created'}</span>
              </p>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                {data.segments.map((s, i) => (
                  <span
                    key={i}
                    style={{
                      width: `${(days(s.start, s.end) / (total || 1)) * 100}%`,
                      background: stageColor(s.stage),
                    }}
                  />
                ))}
              </div>
              <ul className="space-y-1 text-sm">
                {data.segments.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: stageColor(s.stage) }} />
                    <span className="flex-1 truncate">{stageLabel(s.stage)}</span>
                    <span className="text-xs text-mute tabular-nums">{fmtDays(days(s.start, s.end))}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()
      )}
    </Card>
  );
}
