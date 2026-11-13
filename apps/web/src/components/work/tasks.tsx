'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, Check, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { del, patch, post } from '@/lib/api';
import { date, today } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { useTeam } from '@/lib/team';
import { Badge, Button, Field, Menu, Modal, useConfirm, useToast } from '@/components/ui';
import { formErrors } from './util';
import { splitTarget, useTargets, type TargetValue } from './useTargets';
import { TargetSelect } from './TargetSelect';

export interface Task {
  id: string;
  title: string;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  visibility: 'internal' | 'client';
  completed: boolean;
  completed_at?: string | null;
  urgent: boolean;
  kind?: string;
  lead_id: string | null;
  lead_name?: string | null;
  project_id: string | null;
  project_name?: string | null;
  created_at?: string;
}

export function taskLink(t: Pick<Task, 'lead_id' | 'project_id'>) {
  return t.project_id ? `/projects/${t.project_id}?tab=tasks` : t.lead_id ? `/leads/${t.lead_id}?tab=tasks` : null;
}

export function dueTone(t: Pick<Task, 'due_date' | 'completed'>): 'danger' | 'warn' | 'neutral' {
  if (t.completed || !t.due_date) return 'neutral';
  const d = today();
  if (t.due_date < d) return 'danger';
  if (t.due_date === d) return 'warn';
  return 'neutral';
}

/** Create or edit a task linked to a lead or a project. */
export function TaskModal({
  open,
  onClose,
  task,
  onSaved,
  defaultTarget = '',
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  onSaved: (t: Task) => void;
  defaultTarget?: TargetValue;
}) {
  const { user } = useSession();
  const team = useTeam();
  const targets = useTargets();
  const toast = useToast();
  const editing = !!task;
  const [form, setForm] = useState({ title: '', dueDate: '', assigneeId: '', urgent: false, visibility: 'internal' as 'internal' | 'client', target: '' as TargetValue });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setGeneral('');
    setForm(
      task
        ? {
            title: task.title,
            dueDate: task.due_date ?? '',
            assigneeId: task.assignee_id ?? '',
            urgent: task.urgent,
            visibility: task.visibility,
            target: task.project_id ? `project:${task.project_id}` : task.lead_id ? `lead:${task.lead_id}` : '',
          }
        : { title: '', dueDate: '', assigneeId: user?.id ?? '', urgent: false, visibility: 'internal', target: defaultTarget },
    );
  }, [open, task, user, defaultTarget]);

  const isProject = form.target.startsWith('project:');
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local.title = 'Add a title.';
    if (!editing && !form.target) local.target = 'Link the task to a lead or project.';
    if (Object.keys(local).length) return setErrors(local);
    setSaving(true);
    setGeneral('');
    const body = {
      title: form.title.trim(),
      dueDate: form.dueDate,
      assigneeId: form.assigneeId,
      urgent: form.urgent,
      ...(isProject ? { visibility: form.visibility } : {}),
    };
    try {
      let saved: Task;
      if (task) saved = await patch<Task>(`/tasks/${task.id}`, body);
      else {
        const { leadId, projectId } = splitTarget(form.target);
        saved = await post<Task>(projectId ? `/projects/${projectId}/tasks` : `/leads/${leadId}/tasks`, body);
      }
      toast.success(editing ? 'Task updated' : 'Task added');
      onSaved(saved);
      onClose();
    } catch (err) {
      const f = formErrors(err, ['title', 'dueDate', 'assigneeId', 'visibility', 'urgent']);
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
      title={editing ? 'Edit task' : 'New task'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={saving}>
            {editing ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{general}</p>}
        <Field label="Title" required error={errors.title}>
          <input className="input" value={form.title} maxLength={500} onChange={(e) => set('title', e.target.value)} placeholder="What needs to happen?" />
        </Field>
        <Field label="Linked to" required={!editing} error={errors.target} hint={editing ? 'A task stays with the lead or project it was created on.' : undefined}>
          <TargetSelect targets={targets} value={form.target} onChange={(v) => set('target', v)} disabled={editing} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due date" error={errors.dueDate}>
            <input type="date" className="input" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
          <Field label="Assignee" error={errors.assigneeId}>
            <select className="input" value={form.assigneeId} onChange={(e) => set('assigneeId', e.target.value)}>
              <option value="">Unassigned</option>
              {team.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.id === user?.id ? ' (you)' : ''}
                </option>
              ))}
              {task?.assignee_id && !team.some((u) => u.id === task.assignee_id) && <option value={task.assignee_id}>{task.assignee_name ?? 'Current assignee'}</option>}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.urgent} onChange={(e) => set('urgent', e.target.checked)} className="h-4 w-4 accent-[var(--acc)]" />
            Urgent
          </label>
          {isProject && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.visibility === 'client'}
                onChange={(e) => set('visibility', e.target.checked ? 'client' : 'internal')}
                className="h-4 w-4 accent-[var(--acc)]"
              />
              Show in the client portal
            </label>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** One task row with inline complete, edit and delete. */
export function TaskRow({
  task,
  onChange,
  onRemove,
  onEdit,
  showTarget = true,
  showAssignee = true,
}: {
  task: Task;
  onChange: (t: Task) => void;
  onRemove?: (id: string) => void;
  onEdit?: (t: Task) => void;
  showTarget?: boolean;
  showAssignee?: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const tone = dueTone(task);
  const link = taskLink(task);

  const toggle = async () => {
    setBusy(true);
    try {
      onChange(await patch<Task>(`/tasks/${task.id}`, { completed: !task.completed }));
      if (!task.completed) toast.success('Task completed');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this task?', description: task.title, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/tasks/${task.id}`);
      onRemove?.(task.id);
      toast.success('Task deleted');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="group flex items-start gap-3 py-2.5">
      <button
        onClick={toggle}
        disabled={busy}
        aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition disabled:opacity-50',
          task.completed ? 'border-acc bg-acc text-acc-ink' : 'border-line hover:border-acc',
        )}
      >
        {task.completed && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', task.completed && 'text-mute line-through')}>
          {task.urgent && !task.completed && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-danger" aria-label="Urgent" />}
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
          {task.due_date && (
            <span className={cn('inline-flex items-center gap-1', tone === 'danger' && 'text-danger', tone === 'warn' && 'text-warn')}>
              <CalendarDays className="h-3 w-3" />
              {tone === 'danger' ? 'Overdue · ' : tone === 'warn' ? 'Today · ' : ''}
              {date(task.due_date, { year: undefined })}
            </span>
          )}
          {showTarget && link && (task.project_name || task.lead_name) && (
            <Link href={link} className="truncate hover:text-ink hover:underline">
              {task.project_name ? `Project · ${task.project_name}` : `Lead · ${task.lead_name}`}
            </Link>
          )}
          {showAssignee && <span>{task.assignee_name ?? 'Unassigned'}</span>}
          {task.visibility === 'client' && (
            <Badge tone="info">
              <Users className="h-3 w-3" /> Client
            </Badge>
          )}
          {task.kind === 'record_outcome' && <Badge tone="violet">Record outcome</Badge>}
        </div>
      </div>
      {(onEdit || onRemove) && (
        <Menu
          trigger={(open) => (
            <Button variant="ghost" size="icon" onClick={open} aria-label={`Actions for ${task.title}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          )}
          items={[
            ...(onEdit ? [{ label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit(task) }] : []),
            ...(onRemove ? [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: remove }] : []),
          ]}
        />
      )}
    </div>
  );
}
