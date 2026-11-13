'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Briefcase,
  CalendarDays,
  CheckSquare,
  FileText,
  Phone,
  Plus,
  Receipt,
  Sun,
  UserPlus,
  Users,
} from 'lucide-react';
import { get, qs } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { dateTime, money, relative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Avatar, Badge, Button, Card, ErrorBox, PageHeader, Segmented, Skeleton, Stat } from '@/components/ui';
import { TaskModal, TaskRow, type Task } from '@/components/work/tasks';
import { MeetingItem, type MeetingLike } from '@/components/work/MeetingItem';
import { MeetingModal } from '@/components/work/meetings';
import { dayPeriod } from '@/components/work/util';

type Range = 'week' | 'month' | '30d';

interface Dashboard {
  currency: string;
  metrics: { activeProjects: number; pipelineValue: number; unpaidBalance?: number; openTasks: number };
  activity: { id: string; project_id: string; project_name: string; description: string; actor_name: string | null; created_at: string }[];
  tasks: Task[];
  meetings: MeetingLike[];
  leads: { active: number; new: number; recent: { id: string; name: string; company: string | null; stage: string; created_at: string }[] };
  period?: { newLeads: number; newProjects: number; tasksDue: number; received?: number };
}
interface Calls {
  today: MeetingLike[];
  upcoming: MeetingLike[];
  outcomePending: MeetingLike[];
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(r: Range) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end: Date;
  if (r === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else if (r === 'month') {
    start.setDate(1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  } else {
    start.setDate(start.getDate() - 29);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }
  const last = new Date(end);
  last.setDate(last.getDate() - 1);
  return { from: start.toISOString(), to: end.toISOString(), fromDay: ymd(start), toDay: ymd(last) };
}

/** Project activity text may embed [[at:ISO]] timestamps; show them in local time. */
function activityText(text: string) {
  return text.replace(/\[\[at:([^\]]+)\]\]/g, (_, iso: string) => dateTime(iso));
}

const RANGE_LABEL: Record<Range, string> = { week: 'this week', month: 'this month', '30d': 'in the last 30 days' };

export default function HomePage() {
  const { user, isAdmin, workspace } = useSession();
  const [range, setRange] = useState<Range>('week');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const period = useMemo(() => rangeFor(range), [range]);
  const dash = useLoad((s) => get<Dashboard>(`/dashboard${qs(period)}`, s), [period.from, period.to]);
  const day = useMemo(() => dayPeriod(), []);
  const calls = useLoad((s) => get<Calls>(`/dashboard/calls${qs({ from: day.from, to: day.to, scope })}`, s), [scope]);
  const [newTask, setNewTask] = useState(false);
  const [newMeeting, setNewMeeting] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const d = dash.data;
  const currency = d?.currency ?? workspace?.currency ?? 'INR';
  const setTasks = (fn: (t: Task[]) => Task[]) => dash.setData((x) => (x ? { ...x, tasks: fn(x.tasks) } : x));

  return (
    <>
      <PageHeader
        eyebrow={workspace?.name ?? 'Overview'}
        title="Dashboard"
        description={`Welcome back, ${user?.name.split(' ')[0] ?? ''}. Here is how the business is moving.`}
        actions={
          <>
            <Link href="/today">
              <Button variant="secondary" tabIndex={-1}>
                <Sun className="h-4 w-4" /> My day
              </Button>
            </Link>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
                { value: '30d', label: '30 days' },
              ]}
            />
          </>
        }
      />

      {dash.error ? (
        <ErrorBox error={dash.error} retry={dash.reload} />
      ) : !d ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Active projects"
              value={d.metrics.activeProjects}
              hint={`${d.period?.newProjects ?? 0} new ${RANGE_LABEL[range]}`}
            />
            <Stat label="Pipeline value" value={money(d.metrics.pipelineValue, currency)} hint="Open projects in delivery" />
            {isAdmin && d.metrics.unpaidBalance !== undefined ? (
              <Stat
                label="Unpaid invoices"
                value={money(d.metrics.unpaidBalance, currency)}
                tone={d.metrics.unpaidBalance > 0 ? 'warn' : undefined}
                hint={d.period?.received !== undefined ? `${money(d.period.received, currency)} received ${RANGE_LABEL[range]}` : undefined}
              />
            ) : (
              <Stat label="Active leads" value={d.leads.active} hint={`${d.leads.new} in the first stage`} />
            )}
            <Stat label="Open tasks" value={d.metrics.openTasks} hint={`${d.period?.tasksDue ?? 0} due ${RANGE_LABEL[range]}`} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { href: '/leads', label: 'Leads', icon: UserPlus, hint: `${d.period?.newLeads ?? 0} new ${RANGE_LABEL[range]}` },
              { href: '/projects', label: 'Projects', icon: Briefcase, hint: `${d.metrics.activeProjects} active` },
              ...(isAdmin
                ? [{ href: '/invoices', label: 'Invoices', icon: Receipt, hint: 'Billing & payments' }]
                : [{ href: '/clients', label: 'Clients', icon: Users, hint: 'Contacts' }]),
              { href: '/reports', label: 'Reports', icon: FileText, hint: 'Sales & delivery' },
            ].map((q) => (
              <Link key={q.href} href={q.href} className="card group flex items-center gap-3 p-3 transition hover:border-acc/40">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-acc-soft text-acc">
                  <q.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{q.label}</p>
                  <p className="truncate text-xs text-mute">{q.hint}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-acc" />
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card
            title="Calls today"
            icon={<Phone className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2">
                <Segmented
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: 'mine', label: 'Mine' },
                    { value: 'team', label: 'Team' },
                  ]}
                />
                <Button size="sm" variant="ghost" onClick={() => setNewMeeting(true)} aria-label="Schedule a meeting">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
            bodyClassName="p-1.5"
          >
            {calls.error ? (
              <div className="p-2">
                <ErrorBox error={calls.error} retry={calls.reload} />
              </div>
            ) : !calls.data ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                {calls.data.today.length === 0 ? (
                  <p className="px-2.5 py-3 text-sm text-mute">No calls today.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {calls.data.today.map((m) => (
                      <MeetingItem key={m.id} m={m} />
                    ))}
                  </div>
                )}
                {calls.data.outcomePending.length > 0 && (
                  <>
                    <p className="eyebrow mt-2 px-2.5 pt-2 text-warn">Outcome not recorded</p>
                    <div className="divide-y divide-line">
                      {calls.data.outcomePending.slice(0, 5).map((m) => (
                        <MeetingItem key={m.id} m={m} showDate needsOutcome />
                      ))}
                    </div>
                  </>
                )}
                {calls.data.upcoming.length > 0 && (
                  <>
                    <p className="eyebrow mt-2 px-2.5 pt-2">Next 7 days</p>
                    <div className="divide-y divide-line">
                      {calls.data.upcoming.slice(0, 5).map((m) => (
                        <MeetingItem key={m.id} m={m} showDate />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Card>

          <Card
            title={isAdmin ? 'Open tasks' : 'My open tasks'}
            icon={<CheckSquare className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setNewTask(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
                <Link href="/tasks" className="px-1 text-xs text-mute hover:text-ink">
                  View all
                </Link>
              </div>
            }
            bodyClassName="px-4 py-1"
          >
            {!d ? (
              <div className="space-y-2 py-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : d.tasks.length === 0 ? (
              <p className="py-4 text-sm text-mute">No open tasks. Nice.</p>
            ) : (
              <div className="divide-y divide-line">
                {d.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    showAssignee={isAdmin}
                    onEdit={setEditing}
                    onChange={(n) => setTasks((list) => list.map((x) => (x.id === n.id ? n : x)))}
                    onRemove={(id) => setTasks((list) => list.filter((x) => x.id !== id))}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="Upcoming meetings"
            icon={<CalendarDays className="h-4 w-4" />}
            action={
              <Link href="/meetings" className="text-xs text-mute hover:text-ink">
                All
              </Link>
            }
            bodyClassName="p-1.5"
          >
            {!d ? (
              <Skeleton className="m-2 h-10" />
            ) : d.meetings.length === 0 ? (
              <p className="px-2.5 py-3 text-sm text-mute">Nothing scheduled.</p>
            ) : (
              <div className="divide-y divide-line">
                {d.meetings.map((m) => (
                  <MeetingItem key={m.id} m={m} showDate />
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Newest leads"
            icon={<UserPlus className="h-4 w-4" />}
            action={
              <Link href="/leads" className="text-xs text-mute hover:text-ink">
                {d ? `${d.leads.active} active` : 'Leads'}
              </Link>
            }
            bodyClassName="px-4 py-1"
          >
            {!d ? (
              <Skeleton className="my-3 h-10" />
            ) : d.leads.recent.length === 0 ? (
              <p className="py-4 text-sm text-mute">No active leads yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.leads.recent.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <Avatar name={l.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="truncate text-xs text-mute">{l.company || '—'}</p>
                      </div>
                      <Badge>{l.stage}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent activity" icon={<Activity className="h-4 w-4" />} bodyClassName="px-4 py-1">
            {!d ? (
              <Skeleton className="my-3 h-24" />
            ) : d.activity.length === 0 ? (
              <p className="py-4 text-sm text-mute">Project activity will appear here.</p>
            ) : (
              <ol className="divide-y divide-line">
                {d.activity.map((a) => (
                  <li key={a.id} className="py-2.5">
                    <p className="text-sm">{activityText(a.description)}</p>
                    <p className="mt-0.5 text-xs text-mute">
                      <Link href={`/projects/${a.project_id}`} className="hover:text-ink hover:underline">
                        {a.project_name}
                      </Link>
                      {a.actor_name ? ` · ${a.actor_name}` : ''} · {relative(a.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <TaskModal
        open={newTask}
        onClose={() => setNewTask(false)}
        onSaved={(t) => {
          setTasks((list) => [t, ...list]);
          dash.reload();
        }}
      />
      <TaskModal
        open={!!editing}
        task={editing}
        onClose={() => setEditing(null)}
        onSaved={(n) => setTasks((list) => list.map((x) => (x.id === n.id ? n : x)))}
      />
      <MeetingModal
        open={newMeeting}
        onClose={() => setNewMeeting(false)}
        onSaved={() => {
          calls.reload();
          dash.reload();
        }}
      />
    </>
  );
}
