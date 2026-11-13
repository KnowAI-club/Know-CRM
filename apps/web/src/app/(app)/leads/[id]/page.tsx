'use client';
import { Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, Globe, Mail, Phone } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { date } from '@/lib/format';
import { Badge, Card, ErrorBox, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { useLeadMeta } from '@/components/leads/useLeadMeta';
import { LeadProfile } from '@/components/leads/LeadProfile';
import { LeadStatusCard, NurtureCard } from '@/components/leads/LeadStatus';
import {
  LeadCycle, LeadFiles, LeadHistory, LeadMeetings, LeadNotes, LeadTasks, type HistoryEntry, type LeadMeeting,
} from '@/components/leads/LeadWork';
import { STATE_LABELS, STATE_TONES, withDefaults, type Lead } from '@/components/leads/types';

type Tab = 'profile' | 'meetings' | 'tasks' | 'files' | 'notes' | 'history';

interface Detail {
  lead: Lead;
  attachments: Parameters<typeof LeadFiles>[0]['attachments'];
  meetings: LeadMeeting[];
  history: HistoryEntry[];
}

function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs: Tab[] = ['profile', 'meetings', 'tasks', 'files', 'notes', 'history'];
  const tab = (tabs.find((t) => t === params.get('tab')) ?? 'profile') as Tab;
  const meta = useLeadMeta();
  const { data, error, loading, reload, setData } = useLoad((s) => get<Detail>(`/leads/${id}`, s), [id]);

  const setTab = (t: Tab) => router.replace(`${pathname}${t === 'profile' ? '' : `?tab=${t}`}`, { scroll: false });
  /** Apply a fresh lead row, then refresh history/attachments in the background. */
  const applyLead = useCallback(
    (lead: Lead) => {
      setData((cur) => (cur ? { ...cur, lead } : cur));
      void reload();
    },
    [reload, setData],
  );

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!data) return null;
  const { lead } = data;
  const d = withDefaults(lead.data);
  const stageColor = (sid: string) => meta.stages.find((s) => s.id === sid)?.color ?? 'var(--faint)';

  return (
    <div>
      <PageHeader
        back={{ href: lead.state === 'active' ? '/leads' : `/leads?state=${lead.state}`, label: 'Leads' }}
        eyebrow={d.company || 'Lead'}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {lead.name}
            <Badge tone={STATE_TONES[lead.state]}>{STATE_LABELS[lead.state]}</Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 hover:text-ink">
              <Mail className="h-3.5 w-3.5" /> {lead.email}
            </a>
            {d.phone && (
              <a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Phone className="h-3.5 w-3.5" /> {d.phone}
              </a>
            )}
            {d.website && (
              <a href={d.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-ink">
                <Globe className="h-3.5 w-3.5" /> Website
              </a>
            )}
            {lead.contact_id && (
              <Link href={`/clients/${lead.contact_id}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Building2 className="h-3.5 w-3.5" /> Contact record
              </Link>
            )}
            <span>Created {date(lead.created_at)}</span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            className="mb-4"
            tabs={[
              { value: 'profile', label: 'Profile' },
              { value: 'meetings', label: 'Meetings', count: data.meetings.length },
              { value: 'tasks', label: 'Tasks' },
              { value: 'files', label: 'Files & comments', count: data.attachments.length },
              { value: 'notes', label: 'Notes' },
              { value: 'history', label: 'History' },
            ]}
          />
          <div className="card p-4">
            {tab === 'profile' && (
              <LeadProfile
                lead={lead}
                sources={meta.sources}
                industries={meta.industries}
                onOptionsChanged={meta.reload}
                onSaved={applyLead}
                onConflict={reload}
              />
            )}
            {tab === 'meetings' && <LeadMeetings lead={lead} meetings={data.meetings} onCreated={reload} />}
            {tab === 'tasks' && <LeadTasks lead={lead} />}
            {tab === 'files' && <LeadFiles lead={lead} attachments={data.attachments} onChanged={reload} />}
            {tab === 'notes' && <LeadNotes lead={lead} onChanged={reload} />}
            {tab === 'history' && <LeadHistory history={data.history} stageLabel={meta.stageLabel} />}
          </div>
        </div>

        <aside className="space-y-4">
          <LeadStatusCard lead={lead} stages={meta.stages} onChanged={applyLead} onConflict={reload} />
          {lead.nurture && <NurtureCard lead={lead} onChanged={applyLead} onConflict={reload} />}
          <Card title="Summary">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-mute">Owner</dt>
                <dd>{lead.owner_name ?? <span className="text-warn">Unassigned</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Source</dt>
                <dd>{d.source || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Funnel</dt>
                <dd className="capitalize">{d.funnel}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Temperature</dt>
                <dd className="capitalize">{d.temperature}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Budget</dt>
                <dd>{d.budget || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Timeline</dt>
                <dd>{d.timeline || '—'}</dd>
              </div>
            </dl>
          </Card>
          <LeadCycle leadId={lead.id} version={lead.version} stageLabel={meta.stageLabel} stageColor={stageColor} />
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <LeadDetail />
    </Suspense>
  );
}
