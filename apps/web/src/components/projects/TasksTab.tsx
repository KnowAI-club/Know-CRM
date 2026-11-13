'use client';
import { useState, type FormEvent } from 'react';
import { CheckSquare, Eye, Pencil, Trash2 } from 'lucide-react';
import { del, patch, post } from '@/lib/api';
import { useTeam } from '@/lib/team';
import { date } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, Empty, Field, Modal, useConfirm, useToast } from '@/components/ui';
import type { Participant, Task, Visibility } from './types';
import { fieldErrors } from './util';

interface Form {
  title: string;
  dueDate: string;
  assigneeId: string;
  visibility: Visibility;
  urgent: boolean;
}
const blank: Form = { title: '', dueDate: '', assigneeId: '', visibility: 'internal', urgent: false };

export function TasksTab({
  projectId,
  tasks,
  participants,
  onChange,
}: {
  projectId: string;
  tasks: Task[];
  participants: Participant[];
  onChange: (t: Task[]) => void;
}) {
  const team = useTeam();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; form: Form } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const assignees = [...team.map((u) => ({ id: u.id, label: u.name, client: false })), ...participants.map((p) => ({ id: p.id, label: `${p.name} (client)`, client: true }))];

  const submit = async (e: FormEvent, f: Form, id?: string) => {
    e.preventDefault();
    if (!f.title.trim()) return setErrors({ title: 'Describe the task.' });
    setSaving(true);
    try {
      if (id) {
        const t = await patch<Task>(`/tasks/${id}`, { ...f });
        onChange(tasks.map((x) => (x.id === id ? t : x)));
        setEditing(null);
      } else {
        const t = await post<Task>(`/projects/${projectId}/tasks`, { ...f });
        onChange([t, ...tasks]);
        setForm(blank);
      }
      setErrors({});
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: Task) => {
    onChange(tasks.map((x) => (x.id === t.id ? { ...x, completed: !t.completed } : x)));
    try {
      const u = await patch<Task>(`/tasks/${t.id}`, { completed: !t.completed });
      onChange(tasks.map((x) => (x.id === t.id ? u : x)));
    } catch (e) {
      onChange(tasks);
      toast.error(e);
    }
  };

  const remove = async (t: Task) => {
    if (!(await confirm({ title: 'Delete task?', description: t.title, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/tasks/${t.id}`);
      onChange(tasks.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(e);
    }
  };

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const today = new Date().toISOString().slice(0, 10);

  const fields = (f: Form, set: (f: Form) => void) => (
    <>
      <Field label="Due date" error={errors.dueDate}>
        <input className="input" type="date" value={f.dueDate} onChange={(e) => set({ ...f, dueDate: e.target.value })} />
      </Field>
      <Field label="Assignee" error={errors.assigneeId}>
        <select
          className="input"
          value={f.assigneeId}
          onChange={(e) => {
            const client = assignees.find((a) => a.id === e.target.value)?.client;
            set({ ...f, assigneeId: e.target.value, visibility: client ? 'client' : f.visibility });
          }}
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Visibility" error={errors.visibility}>
        <select className="input" value={f.visibility} onChange={(e) => set({ ...f, visibility: e.target.value as Visibility })}>
          <option value="internal">Internal</option>
          <option value="client">Shared with client</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={f.urgent} onChange={(e) => set({ ...f, urgent: e.target.checked })} /> Urgent
      </label>
    </>
  );

  const row = (t: Task) => (
    <li key={t.id} className="group flex items-start gap-3 py-2.5">
      <input type="checkbox" className="mt-1" checked={t.completed} onChange={() => toggle(t)} aria-label={`Complete ${t.title}`} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', t.completed && 'text-mute line-through')}>{t.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-mute">
          {t.assignee_name && <span>{t.assignee_name}</span>}
          {t.due_date && <span className={cn(!t.completed && t.due_date < today && 'font-medium text-danger')}>Due {date(t.due_date, { year: undefined })}</span>}
          {t.urgent && <Badge tone="danger">Urgent</Badge>}
          {t.visibility === 'client' && (
            <Badge tone="info">
              <Eye className="h-3 w-3" /> Client
            </Badge>
          )}
        </div>
      </div>
      <div className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Edit task"
          onClick={() => {
            setErrors({});
            setEditing({ id: t.id, form: { title: t.title, dueDate: t.due_date ?? '', assigneeId: t.assignee_id ?? '', visibility: t.visibility, urgent: t.urgent } });
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Delete task" onClick={() => remove(t)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <Card title="Add task" icon={<CheckSquare className="h-4 w-4" />}>
        <form onSubmit={(e) => submit(e, form)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]" noValidate>
          <Field label="Task" error={editing ? undefined : errors.title} className="sm:col-span-2 lg:col-span-1">
            <input className="input" value={form.title} maxLength={500} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What needs doing?" />
          </Field>
          {fields(form, setForm)}
          <Button type="submit" loading={saving && !editing} className="self-end">
            Add
          </Button>
        </form>
      </Card>
      <Card title={`Open tasks (${open.length})`} bodyClassName="px-4 py-1">
        {open.length ? <ul className="divide-y divide-line">{open.map(row)}</ul> : <Empty title="All clear" description="No open tasks on this project." />}
      </Card>
      {done.length > 0 && (
        <Card
          title={`Completed (${done.length})`}
          bodyClassName={showDone ? 'px-4 py-1' : 'hidden'}
          action={
            <Button size="sm" variant="ghost" onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Hide' : 'Show'}
            </Button>
          }
        >
          <ul className="divide-y divide-line">{done.map(row)}</ul>
        </Card>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit task"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-task" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <form id="edit-task" onSubmit={(e) => submit(e, editing.form, editing.id)} className="grid gap-3 sm:grid-cols-2" noValidate>
            <Field label="Task" error={errors.title} className="sm:col-span-2">
              <input className="input" value={editing.form.title} maxLength={500} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, title: e.target.value } })} />
            </Field>
            {fields(editing.form, (f) => setEditing({ ...editing, form: f }))}
          </form>
        )}
      </Modal>
    </div>
  );
}
