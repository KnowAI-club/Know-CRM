'use client';
import { useMemo, useState } from 'react';
import { CheckSquare, Plus, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { today } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTeam } from '@/lib/team';
import { Button, Card, Empty, ErrorBox, PageHeader, Segmented, Skeleton, Tabs } from '@/components/ui';
import { TaskModal, TaskRow, type Task } from '@/components/work/tasks';

type Status = 'open' | 'done' | 'all';
type Due = 'any' | 'overdue' | 'today' | 'week' | 'none';

export default function TasksPage() {
  const { user, isAdmin } = useSession();
  const team = useTeam();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Task[]>('/tasks', s));
  const [status, setStatus] = useState<Status>('open');
  const [due, setDue] = useState<Due>('any');
  const [who, setWho] = useState<string>('mine');
  const [linked, setLinked] = useState<'all' | 'lead' | 'project'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const d = today();
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekEnd = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`;
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((t) => {
      if (status === 'open' && t.completed) return false;
      if (status === 'done' && !t.completed) return false;
      if (who === 'mine' && t.assignee_id !== user?.id) return false;
      if (who === 'unassigned' && t.assignee_id) return false;
      if (who !== 'mine' && who !== 'all' && who !== 'unassigned' && t.assignee_id !== who) return false;
      if (linked === 'lead' && !t.lead_id) return false;
      if (linked === 'project' && !t.project_id) return false;
      if (due === 'overdue' && !(t.due_date && t.due_date < d && !t.completed)) return false;
      if (due === 'today' && t.due_date !== d) return false;
      if (due === 'week' && !(t.due_date && t.due_date >= d && t.due_date <= weekEnd)) return false;
      if (due === 'none' && t.due_date) return false;
      if (term && ![t.title, t.lead_name, t.project_name, t.assignee_name].some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [data, status, who, linked, due, q, user]);

  const counts = useMemo(() => {
    const scoped = (data ?? []).filter((t) => who !== 'mine' || t.assignee_id === user?.id);
    return { open: scoped.filter((t) => !t.completed).length, done: scoped.filter((t) => t.completed).length, all: scoped.length };
  }, [data, who, user]);

  const upsert = (t: Task) =>
    setData((list) => {
      const rest = (list ?? []).filter((x) => x.id !== t.id);
      return [t, ...rest].sort(
        (a, b) => Number(a.completed) - Number(b.completed) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      );
    });

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        description={isAdmin ? 'Every task across leads and projects.' : 'Tasks assigned to you across leads and projects.'}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        }
      />
      <Tabs
        className="mb-4"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'open', label: 'Open', count: counts.open },
          { value: 'done', label: 'Completed', count: counts.done },
          { value: 'all', label: 'All', count: counts.all },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input pl-8"
            placeholder="Search tasks"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search tasks"
          />
        </div>
        {isAdmin && (
          <select className="input w-auto" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assignee">
            <option value="mine">Assigned to me</option>
            <option value="all">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {team
              .filter((u) => u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        <select className="input w-auto" value={due} onChange={(e) => setDue(e.target.value as Due)} aria-label="Due">
          <option value="any">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Next 7 days</option>
          <option value="none">No due date</option>
        </select>
        <Segmented
          value={linked}
          onChange={setLinked}
          options={[
            { value: 'all', label: 'All' },
            { value: 'lead', label: 'Leads' },
            { value: 'project', label: 'Projects' },
          ]}
        />
      </div>
      <Card bodyClassName="px-4 py-1">
        {error ? (
          <div className="py-3">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : loading && !data ? (
          <div className="space-y-3 py-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            icon={<CheckSquare className="h-5 w-5" />}
            title={status === 'open' ? 'Nothing open here' : 'No tasks match'}
            description="Adjust the filters or add a task to a lead or project."
            action={
              <Button variant="soft" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New task
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {filtered.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onChange={upsert}
                onEdit={setEditing}
                onRemove={(id) => setData((list) => (list ?? []).filter((x) => x.id !== id))}
                showAssignee={who !== 'mine'}
              />
            ))}
          </div>
        )}
      </Card>
      {filtered.length > 0 && <p className="mt-2 text-xs text-faint">{filtered.length} shown</p>}
      <TaskModal open={creating} onClose={() => setCreating(false)} onSaved={upsert} />
      <TaskModal open={!!editing} task={editing} onClose={() => setEditing(null)} onSaved={upsert} />
    </>
  );
}
