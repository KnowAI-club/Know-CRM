'use client';
import { Suspense, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MoreHorizontal, Pencil } from 'lucide-react';
import { get, patch } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date, money } from '@/lib/format';
import { Badge, Button, ErrorBox, Menu, PageHeader, Skeleton, Spinner, Tabs, useToast } from '@/components/ui';
import { OverviewTab } from '@/components/projects/OverviewTab';
import { TasksTab } from '@/components/projects/TasksTab';
import { NotesTab } from '@/components/projects/NotesTab';
import { FilesTab } from '@/components/projects/FilesTab';
import { ActivityTab, DocumentsTab, InvoicesTab, MeetingsTab } from '@/components/projects/ListTabs';
import { MessageThread } from '@/components/projects/MessageThread';
import { TimeTab } from '@/components/projects/TimeTab';
import { AccessTab } from '@/components/projects/AccessTab';
import { ProjectEditModal } from '@/components/projects/ProjectEdit';
import { StageDot } from '@/components/projects/StageDot';
import type { Project, ProjectDetail, ProjectStage } from '@/components/projects/types';

type Tab = 'overview' | 'tasks' | 'notes' | 'files' | 'meetings' | 'documents' | 'invoices' | 'messages' | 'time' | 'activity' | 'access';

function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const { isAdmin } = useSession();
  const { data, error, loading, reload, setData } = useLoad(
    (s) => Promise.all([get<ProjectDetail>(`/projects/${id}`, s), get<ProjectStage[]>('/project-stages', s)]).then(([detail, stages]) => ({ detail, stages })),
    [id],
  );
  const [editing, setEditing] = useState(false);
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => router.replace(`${pathname}${t === 'overview' ? '' : `?tab=${t}`}`, { scroll: false });

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!data) return <Spinner />;

  const { detail, stages } = data;
  const { project } = detail;
  const update = <K extends keyof ProjectDetail>(k: K, v: ProjectDetail[K]) => setData((d) => d && { ...d, detail: { ...d.detail, [k]: v } });
  const setProject = (p: Project) => update('project', { ...detail.project, ...p });

  const moveStage = async (stageId: string) => {
    try {
      setProject(await patch<Project>(`/projects/${project.id}`, { stage: stageId }));
      toast.success('Stage updated');
      void reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const overdue =
    project.due_date && project.stage_category !== 'completed' && project.stage_category !== 'archived' && new Date(`${project.due_date}T23:59:59`) < new Date();

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'tasks', label: 'Tasks', count: detail.tasks.filter((t) => !t.completed).length },
    { value: 'notes', label: 'Notes', count: detail.notes.length },
    { value: 'files', label: 'Files', count: detail.files.length },
    { value: 'meetings', label: 'Meetings', count: detail.meetings.length },
    { value: 'documents', label: 'Documents', count: detail.documents.length },
    { value: 'invoices', label: 'Invoices', count: detail.invoices.length },
    ...(isAdmin ? [{ value: 'messages' as Tab, label: 'Messages', count: detail.messages.length }] : []),
    { value: 'time', label: 'Time' },
    { value: 'activity', label: 'Activity' },
    ...(isAdmin ? [{ value: 'access' as Tab, label: 'Client access' }] : []),
  ];

  return (
    <div>
      <PageHeader
        back={{ href: '/projects', label: 'Projects' }}
        eyebrow={project.company || project.contact_name}
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StageDot color={project.stage_color} label={project.stage_label} />
            <span className="tabular-nums">{money(project.value, project.currency)}</span>
            <span className={overdue ? 'font-medium text-danger' : undefined}>Due {date(project.due_date)}</span>
            <span>Owner {project.owner_name}</span>
            {overdue && <Badge tone="danger">Overdue</Badge>}
          </span>
        }
        actions={
          <>
            <select className="input w-auto" value={project.stage} onChange={(e) => moveStage(e.target.value)} aria-label="Move to stage">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Menu
              trigger={(open) => (
                <Button variant="ghost" size="icon" onClick={open} aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              )}
              items={[
                { label: 'New invoice', onSelect: () => router.push(`/invoices/new?projectId=${project.id}`) },
                { label: 'New document', onSelect: () => setTab('documents') },
                ...(project.source_lead_id ? [{ label: 'Open source lead', onSelect: () => router.push(`/leads/${project.source_lead_id}`) }] : []),
              ]}
            />
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'overview' && (
        <OverviewTab detail={detail} onProject={setProject} onMilestones={(m) => update('milestones', m)} isAdmin={isAdmin} openAccess={() => setTab('access')} />
      )}
      {tab === 'tasks' && <TasksTab projectId={project.id} tasks={detail.tasks} participants={detail.participants} onChange={(t) => update('tasks', t)} />}
      {tab === 'notes' && <NotesTab projectId={project.id} notes={detail.notes} onChange={(n) => update('notes', n)} />}
      {tab === 'files' && <FilesTab projectId={project.id} files={detail.files} onChange={(f) => update('files', f)} />}
      {tab === 'meetings' && <MeetingsTab projectId={project.id} meetings={detail.meetings} />}
      {tab === 'documents' && <DocumentsTab projectId={project.id} documents={detail.documents} />}
      {tab === 'invoices' && <InvoicesTab projectId={project.id} invoices={detail.invoices} currency={project.currency} />}
      {tab === 'messages' && isAdmin && (
        <div className="card">
          <MessageThread
            projectId={project.id}
            messages={detail.messages}
            onChange={(m) => update('messages', m)}
            side="team"
            emptyText={detail.participants.length ? 'Start the conversation with your client.' : 'Give the client portal access so they can reply here.'}
          />
        </div>
      )}
      {tab === 'time' && <TimeTab projectId={project.id} />}
      {tab === 'activity' && <ActivityTab activity={detail.activity} />}
      {tab === 'access' && isAdmin && (
        <AccessTab projectId={project.id} participants={detail.participants} contact={detail.clientInfo.contact} onChange={(p) => update('participants', p)} />
      )}
      <ProjectEditModal open={editing} onClose={() => setEditing(false)} project={project} stages={stages} onSaved={setProject} />
    </div>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProjectView />
    </Suspense>
  );
}
