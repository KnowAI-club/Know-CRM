'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlarmClock, CalendarCheck2, CheckSquare, ClipboardCheck, Plus, Sparkles, UserRoundSearch } from 'lucide-react';
import { get, qs } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { relative, today as todayYmd } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, PageHeader, Segmented, Skeleton, Stat } from '@/components/ui';
import { TaskModal, TaskRow, type Task } from '@/components/work/tasks';
import { ReminderModal, ReminderRow, type Reminder } from '@/components/work/reminders';
import { MeetingItem, type MeetingLike } from '@/components/work/MeetingItem';
import { dayPeriod } from '@/components/work/util';
import type { TargetValue } from '@/components/work/useTargets';

interface IdleLead {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  updated_at: string;
}
interface TodayData {
  tasks: Task[];
  reminders: Reminder[];
  calls: MeetingLike[];
  outcomePending: MeetingLike[];
  leadsWithoutNextStep: IdleLead[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function TodayPage() {
  const { user } = useSession();
  const [which, setWhich] = useState<'today' | 'tomorrow'>('today');
  const period = useMemo(() => {
    const d = new Date();
    if (which === 'tomorrow') d.setDate(d.getDate() + 1);
    return dayPeriod(d);
  }, [which]);
  const { data, error, loading, reload, setData } = useLoad((s) => get<TodayData>(`/today${qs(period)}`, s), [period.from]);
  const [taskFor, setTaskFor] = useState<TargetValue | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editReminder, setEditReminder] = useState<Reminder | null>(null);

  const d = todayYmd();
  const overdue = (data?.tasks ?? []).filter((t) => !t.completed && t.due_date && t.due_date < d);
  const dueNow = (data?.tasks ?? []).filter((t) => !(t.due_date && t.due_date < d) || t.completed);

  const updateTask = (t: Task) => setData((x) => (x ? { ...x, tasks: x.tasks.map((o) => (o.id === t.id ? { ...o, ...t } : o)) } : x));
  const removeTask = (id: string) => setData((x) => (x ? { ...x, tasks: x.tasks.filter((o) => o.id !== id) } : x));
  const updateReminder = (r: Reminder) =>
    setData((x) => (x ? { ...x, reminders: x.reminders.map((o) => (o.id === r.id ? r : o)).filter((o) => o.status === 'pending' || o.status === 'failed') } : x));

  const dateLabel = new Date(period.from).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <PageHeader
        eyebrow={dateLabel}
        title={which === 'today' ? `${greeting()}, ${user?.name.split(' ')[0] ?? ''}` : 'Tomorrow'}
        description="Your tasks, calls and follow-ups, in one place."
        actions={
          <Segmented
            value={which}
            onChange={setWhich}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'tomorrow', label: 'Tomorrow' },
            ]}
          />
        }
      />
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Tasks due" value={data.tasks.filter((t) => !t.completed).length} hint={overdue.length ? `${overdue.length} overdue` : 'None overdue'} tone={overdue.length ? 'danger' : undefined} />
            <Stat label="Calls" value={data.calls.length} hint={which === 'today' ? 'Scheduled today' : 'Scheduled tomorrow'} />
            <Stat label="Outcomes to record" value={data.outcomePending.length} tone={data.outcomePending.length ? 'warn' : undefined} />
            <Stat label="Reminders" value={data.reminders.length} hint="Due by end of day" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <Card
                title="Tasks"
                icon={<CheckSquare className="h-4 w-4" />}
                action={
                  <Button size="sm" variant="ghost" onClick={() => setTaskFor('')}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                }
                bodyClassName="px-4 py-1"
              >
                {data.tasks.length === 0 ? (
                  <p className="py-4 text-sm text-mute">Nothing due. A good time to move a lead forward.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {overdue.length > 0 && <p className="eyebrow pt-3 text-danger">Overdue</p>}
                    {overdue.map((t) => (
                      <TaskRow key={t.id} task={t} onChange={updateTask} onRemove={removeTask} onEdit={setEditing} showAssignee={false} />
                    ))}
                    {overdue.length > 0 && dueNow.length > 0 && <p className="eyebrow pt-3">Due {which}</p>}
                    {dueNow.map((t) => (
                      <TaskRow key={t.id} task={t} onChange={updateTask} onRemove={removeTask} onEdit={setEditing} showAssignee={false} />
                    ))}
                  </div>
                )}
              </Card>
              <Card title="Reminders" icon={<AlarmClock className="h-4 w-4" />} bodyClassName="px-4 py-1">
                {data.reminders.length === 0 ? (
                  <p className="py-4 text-sm text-mute">No reminders waiting for you.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {data.reminders.map((r) => (
                      <ReminderRow key={r.id} reminder={r} onChange={updateReminder} onEdit={setEditReminder} />
                    ))}
                  </div>
                )}
              </Card>
            </div>
            <div className="space-y-5">
              <Card
                title={which === 'today' ? "Today's calls" : "Tomorrow's calls"}
                icon={<CalendarCheck2 className="h-4 w-4" />}
                action={
                  <Link href="/meetings" className="text-xs text-mute hover:text-ink">
                    All meetings
                  </Link>
                }
                bodyClassName="p-1.5"
              >
                {data.calls.length === 0 ? (
                  <p className="px-2.5 py-3 text-sm text-mute">No calls scheduled.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {data.calls.map((m) => (
                      <MeetingItem key={m.id} m={m} />
                    ))}
                  </div>
                )}
              </Card>
              {data.outcomePending.length > 0 && (
                <Card title="Record outcomes" icon={<ClipboardCheck className="h-4 w-4" />} bodyClassName="p-1.5">
                  <p className="px-2.5 pt-1 pb-2 text-xs text-mute">Past calls without an outcome. Recording it updates the lead and closes the follow-up task.</p>
                  <div className="divide-y divide-line">
                    {data.outcomePending.map((m) => (
                      <MeetingItem key={m.id} m={m} showDate needsOutcome />
                    ))}
                  </div>
                </Card>
              )}
              <Card title="Leads without a next step" icon={<UserRoundSearch className="h-4 w-4" />} bodyClassName="px-4 py-1">
                {data.leadsWithoutNextStep.length === 0 ? (
                  <p className="flex items-center gap-2 py-4 text-sm text-mute">
                    <Sparkles className="h-4 w-4 text-acc" /> Every lead you own has a task, reminder or call lined up.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.leadsWithoutNextStep.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <Link href={`/leads/${l.id}`} className="truncate text-sm font-medium hover:underline">
                            {l.name}
                          </Link>
                          <p className="truncate text-xs text-mute">
                            {l.company ? `${l.company} · ` : ''}
                            <Badge className="mx-0.5">{l.stage}</Badge> updated {relative(l.updated_at)}
                          </p>
                        </div>
                        <Button size="sm" variant="soft" onClick={() => setTaskFor(`lead:${l.id}`)}>
                          <Plus className="h-3.5 w-3.5" /> Task
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      ) : null}
      <TaskModal
        open={taskFor !== null}
        defaultTarget={taskFor ?? ''}
        onClose={() => setTaskFor(null)}
        onSaved={() => void reload()}
      />
      <TaskModal open={!!editing} task={editing} onClose={() => setEditing(null)} onSaved={() => void reload()} />
      <ReminderModal open={!!editReminder} reminder={editReminder} onClose={() => setEditReminder(null)} onSaved={() => void reload()} />
    </>
  );
}
