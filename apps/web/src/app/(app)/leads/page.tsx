'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, KanbanSquare, List, Plus, Search } from 'lucide-react';
import { EXIT_LABELS, type ExitStatus } from '@know-crm/shared';
import { get, patch, qs } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useTeam } from '@/lib/team';
import { date, relative } from '@/lib/format';
import { Badge, Button, Empty, ErrorBox, PageHeader, Segmented, Skeleton, Tabs, useToast } from '@/components/ui';
import { CreateLeadModal } from '@/components/leads/CreateLeadModal';
import { LeadBoard } from '@/components/leads/LeadBoard';
import { LeadActionModal } from '@/components/leads/LeadActionModals';
import { useLeadMeta } from '@/components/leads/useLeadMeta';
import { isConflict, withDefaults, type Lead, type LeadState, type Stage } from '@/components/leads/types';

const STATES: { value: LeadState; label: string }[] = [
  { value: 'active', label: 'Pipeline' },
  { value: 'dropped', label: 'Archived' },
  { value: 'won', label: 'Closed won' },
];

function LeadsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = (STATES.find((s) => s.value === params.get('state'))?.value ?? 'active') as LeadState;
  const view = params.get('view') === 'list' || state !== 'active' ? 'list' : 'board';
  const meta = useLeadMeta();
  const team = useTeam();
  const toast = useToast();
  const { data: leads, error, loading, reload, setData } = useLoad((s) => get<Lead[]>(`/leads${qs({ state })}`, s), [state]);
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [temp, setTemp] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [winning, setWinning] = useState<Lead | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (leads ?? []).filter((l) => {
      const d = withDefaults(l.data);
      if (owner === '__none' ? d.ownerId : owner && d.ownerId !== owner) return false;
      if (source && d.source !== source) return false;
      if (temp && d.temperature !== temp) return false;
      if (term && ![l.name, l.email, d.company, d.phone].some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [leads, q, owner, source, temp]);

  const move = async (lead: Lead, stage: Stage) => {
    if (stage.kind === 'won') return setWinning(lead);
    setBusyId(lead.id);
    const previous = leads;
    setData(leads?.map((l) => (l.id === lead.id ? { ...l, stage: stage.id } : l)));
    try {
      const updated = await patch<Lead>(`/leads/${lead.id}`, { version: lead.version, stage: stage.id });
      setData((cur) => cur?.map((l) => (l.id === lead.id ? { ...l, ...updated } : l)));
      toast.success(`${lead.name} moved to ${stage.label}`);
    } catch (e) {
      setData(previous);
      toast.error(e);
      if (isConflict(e)) void reload();
    } finally {
      setBusyId(null);
    }
  };

  const filtersActive = q || owner || source || temp;

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        description="Track every prospect from first touch to closed won."
        actions={
          <>
            <a href={`/api/leads/export.csv${qs({ state })}`} download>
              <Button variant="secondary">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </a>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New lead
            </Button>
          </>
        }
      />

      <Tabs
        tabs={STATES.map((s) => ({ ...s, count: s.value === state && leads ? leads.length : undefined }))}
        value={state}
        onChange={(v) => setParam('state', v === 'active' ? null : v)}
        className="mb-4"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search name, email, company"
            aria-label="Search leads"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="input w-auto" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All owners</option>
          <option value="__none">No owner</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className="input w-auto" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {meta.sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="input w-auto" aria-label="Temperature" value={temp} onChange={(e) => setTemp(e.target.value)}>
          <option value="">Warm & cold</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => (setQ(''), setOwner(''), setSource(''), setTemp(''))}>
            Clear
          </Button>
        )}
        {state === 'active' && (
          <div className="ml-auto">
            <Segmented
              value={view}
              onChange={(v) => setParam('view', v === 'list' ? 'list' : null)}
              options={[
                { value: 'board', label: 'Board', icon: <KanbanSquare className="h-3.5 w-3.5" /> },
                { value: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
        )}
      </div>

      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : meta.error ? (
        <ErrorBox error={meta.error} retry={meta.reload} />
      ) : loading && !leads ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : view === 'board' ? (
        <LeadBoard leads={filtered} stages={meta.stages} onMove={move} busyId={busyId} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty
            title={filtersActive ? 'No leads match these filters' : 'No leads here yet'}
            description={state === 'active' ? 'Create a lead or share a lead form to start filling the pipeline.' : undefined}
            action={state === 'active' && !filtersActive ? <Button onClick={() => setCreating(true)}>New lead</Button> : undefined}
          />
        </div>
      ) : (
        <LeadTable leads={filtered} state={state} stageLabel={meta.stageLabel} />
      )}

      <CreateLeadModal
        open={creating}
        onClose={() => setCreating(false)}
        sources={meta.sources}
        industries={meta.industries}
        onOptionsChanged={meta.reload}
      />
      {winning && (
        <LeadActionModal
          lead={winning}
          action="won"
          stages={meta.stages}
          onClose={() => setWinning(null)}
          onDone={() => void reload()}
          onConflict={reload}
        />
      )}
    </div>
  );
}

function LeadTable({ leads, state, stageLabel }: { leads: Lead[]; state: LeadState; stageLabel: (id: string) => string }) {
  const router = useRouter();
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Company</th>
            <th>{state === 'active' ? 'Stage' : state === 'won' ? 'Project' : 'Left from'}</th>
            <th>{state === 'active' ? 'Source' : state === 'won' ? 'Won' : 'Reason'}</th>
            <th>Owner</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const d = withDefaults(l.data);
            return (
              <tr key={l.id} className="clickable" onClick={() => router.push(`/leads/${l.id}`)}>
                <td>
                  <Link href={`/leads/${l.id}`} className="font-medium hover:text-acc" onClick={(e) => e.stopPropagation()}>
                    {l.name}
                  </Link>
                  <p className="text-xs text-mute">{l.email}</p>
                </td>
                <td className="text-mute">{d.company || '—'}</td>
                <td>
                  {state === 'won' ? (
                    l.project_id ? (
                      <Link href={`/projects/${l.project_id}`} className="text-acc hover:underline" onClick={(e) => e.stopPropagation()}>
                        {l.project_name ?? 'Project'}
                      </Link>
                    ) : (
                      '—'
                    )
                  ) : (
                    <Badge>{stageLabel(l.stage)}</Badge>
                  )}
                </td>
                <td className="max-w-64 text-mute">
                  {state === 'active' ? (
                    d.source || '—'
                  ) : state === 'won' ? (
                    date(l.won_at)
                  ) : (
                    <div className="space-y-1">
                      {l.exit_status && <Badge tone="warn">{EXIT_LABELS[l.exit_status as ExitStatus] ?? l.exit_status}</Badge>}
                      <p className="line-clamp-1 text-xs">{l.exit_reason || '—'}</p>
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap">{l.owner_name ?? <span className="text-faint">Unassigned</span>}</td>
                <td className="whitespace-nowrap text-mute">{relative(l.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <LeadsPage />
    </Suspense>
  );
}
