'use client';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Briefcase, Columns3, List, Plus, Search } from 'lucide-react';
import { get, patch } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { useTeam } from '@/lib/team';
import { date, money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Avatar, Badge, Button, Empty, ErrorBox, PageHeader, Segmented, Skeleton, Stat, useToast } from '@/components/ui';
import { NewProjectModal } from '@/components/projects/ProjectForm';
import { StageDot } from '@/components/projects/StageDot';
import type { Project, ProjectStage } from '@/components/projects/types';

type Scope = 'open' | 'completed' | 'archived' | 'all';

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export default function ProjectsPage() {
  const router = useRouter();
  const toast = useToast();
  const { currency } = useSession();
  const team = useTeam();
  const { data, error, loading, reload, setData } = useLoad(
    (signal) =>
      Promise.all([get<Project[]>('/projects', signal), get<ProjectStage[]>('/project-stages', signal)]).then(([projects, stages]) => ({
        projects,
        stages,
      })),
    [],
  );
  const [view, setView] = useState<'board' | 'list'>('board');
  useEffect(() => setView(readPref('crm-projects-view', 'board')), []);
  const [scope, setScope] = useState<Scope>('open');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const changeView = (v: 'board' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('crm-projects-view', v);
    } catch {}
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.projects ?? []).filter((p) => {
      if (scope === 'open' && (p.stage_category === 'completed' || p.stage_category === 'archived')) return false;
      if (scope === 'completed' && p.stage_category !== 'completed') return false;
      if (scope === 'archived' && p.stage_category !== 'archived') return false;
      if (owner && p.owner_id !== owner) return false;
      if (term && ![p.name, p.contact_name, p.company].some((s) => s?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [data, scope, owner, q]);

  const stages = useMemo(
    () =>
      (data?.stages ?? []).filter((s) =>
        scope === 'all' ? true : scope === 'open' ? s.category === 'inquiry' || s.category === 'in_progress' : s.category === scope,
      ),
    [data, scope],
  );

  const active = (data?.projects ?? []).filter((p) => p.stage_category === 'in_progress');
  const openValue = (data?.projects ?? [])
    .filter((p) => p.stage_category === 'inquiry' || p.stage_category === 'in_progress')
    .reduce((a, p) => a + Number(p.value || 0), 0);
  const overdue = (data?.projects ?? []).filter(
    (p) => p.due_date && p.stage_category !== 'completed' && p.stage_category !== 'archived' && new Date(`${p.due_date}T23:59:59`) < new Date(),
  );

  const move = async (projectId: string, stageId: string) => {
    const project = data?.projects.find((p) => p.id === projectId);
    if (!project || project.stage === stageId) return;
    const stage = data?.stages.find((s) => s.id === stageId);
    setData((d) =>
      d && {
        ...d,
        projects: d.projects.map((p) =>
          p.id === projectId ? { ...p, stage: stageId, stage_label: stage?.label ?? p.stage_label, stage_color: stage?.color ?? p.stage_color, stage_category: stage?.category ?? p.stage_category } : p,
        ),
      },
    );
    try {
      const updated = await patch<Project>(`/projects/${projectId}`, { stage: stageId });
      setData((d) => d && { ...d, projects: d.projects.map((p) => (p.id === projectId ? { ...p, ...updated } : p)) });
      toast.success(`Moved to ${stage?.label}`);
    } catch (e) {
      toast.error(e);
      void reload();
    }
  };

  const onDrop = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/project');
    if (id) void move(id, stageId);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description="Every engagement from kickoff to handover, with milestones the client can follow in their portal."
        actions={
          <Button onClick={() => setCreating('')}>
            <Plus className="h-4 w-4" /> New project
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In progress" value={loading && !data ? '—' : active.length} />
        <Stat label="Open value" value={loading && !data ? '—' : money(openValue, currency)} />
        <Stat label="Overdue" value={loading && !data ? '—' : overdue.length} tone={overdue.length ? 'warn' : undefined} />
        <Stat label="Completed" value={loading && !data ? '—' : (data?.projects ?? []).filter((p) => p.stage_category === 'completed').length} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search projects or clients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        </div>
        <select className="input w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'completed', label: 'Completed' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="ml-auto">
          <Segmented
            value={view}
            onChange={changeView}
            options={[
              { value: 'board', label: 'Board', icon: <Columns3 className="h-3.5 w-3.5" /> },
              { value: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
      </div>

      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !data?.projects.length ? (
        <div className="card">
          <Empty
            icon={<Briefcase className="h-5 w-5" />}
            title="No projects yet"
            description="Create a project, or close a lead as won to hand it off to delivery."
            action={<Button onClick={() => setCreating('')}>New project</Button>}
          />
        </div>
      ) : view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
          <div className="flex min-w-max gap-3">
            {stages.map((s) => {
              const items = filtered.filter((p) => p.stage === s.id);
              const total = items.reduce((a, p) => a + Number(p.value || 0), 0);
              return (
                <section
                  key={s.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(s.id);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === s.id ? null : d))}
                  onDrop={(e) => onDrop(e, s.id)}
                  className={cn(
                    'flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-subtle/50 p-2 transition',
                    dragOver === s.id && 'border-acc bg-acc-soft/50',
                  )}
                  aria-label={s.label}
                >
                  <header className="flex items-center gap-2 px-2 py-1.5">
                    <StageDot color={s.color} label={s.label} />
                    <span className="text-xs text-faint">{items.length}</span>
                    <span className="ml-auto text-xs text-mute tabular-nums">{money(total, currency)}</span>
                  </header>
                  <div className="flex min-h-24 flex-1 flex-col gap-2">
                    {items.map((p) => (
                      <Link
                        key={p.id}
                        href={`/projects/${p.id}`}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/project', p.id)}
                        className="card block cursor-grab p-3 transition hover:border-acc/40 active:cursor-grabbing"
                      >
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 text-sm font-medium">{p.name}</p>
                          {p.unread && <span className="mt-1.5 h-2 w-2 rounded-full bg-acc" title="Updated since you last opened it" />}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-mute">{p.company || p.contact_name}</p>
                        <div className="mt-3 flex items-center gap-2 text-xs text-mute">
                          <span className="font-medium text-ink tabular-nums">{money(p.value, p.currency)}</span>
                          {p.due_date && <span className="ml-auto">Due {date(p.due_date, { year: undefined })}</span>}
                          <Avatar name={p.owner_name} size="sm" />
                        </div>
                      </Link>
                    ))}
                    <button
                      onClick={() => setCreating(s.id)}
                      className="rounded-lg px-2 py-1.5 text-left text-xs text-mute hover:bg-card hover:text-ink"
                    >
                      + Add project
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Stage</th>
                <th className="text-right">Value</th>
                <th>Due</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => router.push(`/projects/${p.id}`)}>
                  <td>
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {p.name}
                    </Link>
                    {p.unread && <Badge tone="acc" className="ml-2">New</Badge>}
                  </td>
                  <td className="text-mute">{p.company || p.contact_name}</td>
                  <td>
                    <StageDot color={p.stage_color} label={p.stage_label} />
                  </td>
                  <td className="text-right tabular-nums">{money(p.value, p.currency)}</td>
                  <td className="text-mute">{date(p.due_date)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={p.owner_name} size="sm" />
                      <span className="text-mute">{p.owner_name}</span>
                    </span>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-mute">
                    No projects match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <NewProjectModal
        open={creating !== null}
        onClose={() => setCreating(null)}
        stages={data?.stages ?? []}
        defaultStage={creating || undefined}
        onCreated={(p) => {
          setCreating(null);
          router.push(`/projects/${p.id}`);
        }}
      />
    </div>
  );
}
