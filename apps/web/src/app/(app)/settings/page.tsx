'use client';
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Activity, Bell, Building2, CreditCard, KanbanSquare, KeyRound, ListChecks, ScrollText, Users, Workflow } from 'lucide-react';
import { ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import type { WorkspaceSettings } from '@/components/money/types';
import { GeneralSettings } from '@/components/settings/GeneralSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { TeamSettings } from '@/components/settings/TeamSettings';
import { LeadStageSettings, ProjectStageSettings } from '@/components/settings/StageSettings';
import { LabelledListSettings, LeadOptionSettings } from '@/components/settings/ListSettings';
import { NotificationSettings, PasswordSettings } from '@/components/settings/AccountSettings';
import { AuditLog, JobStatus } from '@/components/settings/AdminLogs';

const SECTIONS = [
  { id: 'workspace', label: 'Workspace', icon: Building2, admin: true, group: 'Workspace' },
  { id: 'billing', label: 'Billing & invoices', icon: CreditCard, admin: true, group: 'Workspace' },
  { id: 'team', label: 'Team', icon: Users, admin: false, group: 'Workspace' },
  { id: 'lead-stages', label: 'Lead stages', icon: Workflow, admin: true, group: 'Pipeline' },
  {
    id: 'project-stages',
    label: 'Project stages',
    icon: KanbanSquare,
    admin: true,
    group: 'Pipeline',
  },
  { id: 'lists', label: 'Lists & types', icon: ListChecks, admin: false, group: 'Pipeline' },
  { id: 'notifications', label: 'Notifications', icon: Bell, admin: false, group: 'You' },
  { id: 'password', label: 'Password', icon: KeyRound, admin: false, group: 'You' },
  { id: 'audit', label: 'Audit log', icon: ScrollText, admin: true, group: 'System' },
  { id: 'jobs', label: 'Background jobs', icon: Activity, admin: true, group: 'System' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

function Settings() {
  const { isAdmin } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const visible = SECTIONS.filter((s) => !s.admin || isAdmin);
  const requested = params.get('section') as SectionId | null;
  const active = visible.find((s) => s.id === requested)?.id ?? visible[0]!.id;
  const settings = useLoad((s) => (isAdmin ? get<WorkspaceSettings>('/settings', s) : Promise.resolve(null)), [isAdmin]);
  const groups = [...new Set(visible.map((s) => s.group))];
  const go = (id: SectionId) => router.replace(`${pathname}?section=${id}`, { scroll: false });

  const needsSettings = active === 'workspace' || active === 'billing';
  let body: React.ReactNode;
  if (needsSettings && settings.error) body = <ErrorBox error={settings.error} retry={settings.reload} />;
  else if (needsSettings && !settings.data) body = <Spinner />;
  else
    switch (active) {
      case 'workspace':
        body = (
          <GeneralSettings
            key={settings.data!.name + settings.data!.currency}
            settings={settings.data!}
            onSaved={(s) => settings.setData(s)}
          />
        );
        break;
      case 'billing':
        body = <BillingSettings settings={settings.data!} onSaved={(s) => settings.setData(s)} />;
        break;
      case 'team':
        body = <TeamSettings />;
        break;
      case 'lead-stages':
        body = <LeadStageSettings />;
        break;
      case 'project-stages':
        body = <ProjectStageSettings />;
        break;
      case 'lists':
        body = (
          <div className="space-y-8">
            <LeadOptionSettings />
            <LabelledListSettings
              path="/file-types"
              title="File types"
              noun="file type"
              description="Labels for uploaded project files and lead attachments."
            />
            <LabelledListSettings
              path="/reminder-types"
              title="Reminder types"
              noun="reminder type"
              description="Categories offered when scheduling reminders."
            />
          </div>
        );
        break;
      case 'notifications':
        body = <NotificationSettings />;
        break;
      case 'password':
        body = <PasswordSettings />;
        break;
      case 'audit':
        body = <AuditLog />;
        break;
      case 'jobs':
        body = <JobStatus />;
        break;
    }

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <select
            aria-label="Settings section"
            className="input lg:hidden"
            value={active}
            onChange={(e) => go(e.target.value as SectionId)}
          >
            {visible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="hidden space-y-4 lg:block">
            {groups.map((g) => (
              <div key={g}>
                <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{g}</p>
                {visible
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => go(s.id)}
                      aria-current={active === s.id ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm',
                        active === s.id ? 'bg-acc-soft font-medium text-acc' : 'text-mute hover:bg-subtle hover:text-ink',
                      )}
                    >
                      <s.icon className="h-4 w-4" /> {s.label}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">{body}</div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Settings />
    </Suspense>
  );
}
