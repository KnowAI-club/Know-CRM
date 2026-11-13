'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download } from 'lucide-react';
import { Badge, Card, Empty, ErrorBox, Field, PageHeader, Segmented, Spinner, Stat, Tabs } from '@/components/ui';
import { get, qs } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useTeam } from '@/lib/team';
import { money, today } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Stage {
  id: string;
  label: string;
  color: string;
  kind: 'open' | 'won';
  position: number;
}
interface Lead {
  id: string;
  state: 'active' | 'won' | 'dropped';
  stage: string;
  created_at: string;
  data: { source?: string; ownerId?: string };
}
interface Fact {
  lead_id: string;
  reached: string[];
  booked: number;
  attended: number;
  no_show: number;
}
interface StageDay {
  leadId: string;
  stage: string;
  days: number;
}
interface SourceRow {
  source: string;
  projects: number;
  booked: number;
}

type Tab = 'leads' | 'projects';
type Preset = 'month' | 'last_month' | 'quarter' | 'year' | 'all' | 'custom';

function presetRange(p: Preset, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = iso(new Date(y, m, now.getDate() + 1));
  switch (p) {
    case 'month':
      return { from: iso(new Date(y, m, 1)), to: tomorrow };
    case 'last_month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 1)) };
    case 'quarter':
      return { from: iso(new Date(y, Math.floor(m / 3) * 3, 1)), to: tomorrow };
    case 'year':
      return { from: iso(new Date(y, 0, 1)), to: tomorrow };
    case 'all':
      return { from: '2000-01-01', to: tomorrow };
    default:
      return {
        from: custom.from,
        to: custom.to ? iso(new Date(new Date(`${custom.to}T00:00:00`).getTime() + 86_400_000)) : tomorrow,
      };
  }
}
/** Local-midnight day → ISO instant, so ranges follow the viewer's calendar. */
const instant = (day: string) => new Date(`${day}T00:00:00`).toISOString();

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('leads');
  const [preset, setPreset] = useState<Preset>('quarter');
  const [custom, setCustom] = useState({ from: `${today().slice(0, 8)}01`, to: today() });
  const range = presetRange(preset, custom);
  const validRange = !!range.from && range.from < range.to;

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="How leads move through the pipeline and how delivery and collections are tracking."
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'leads', label: 'Lead report' },
          { value: 'projects', label: 'Project delivery' },
        ]}
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <span className="label">Period</span>
          <select className="input w-44" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Report period">
            <option value="month">This month</option>
            <option value="last_month">Last month</option>
            <option value="quarter">This quarter</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <Field label="From">
              <input
                type="date"
                className="input"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </Field>
            <Field label="To" error={validRange ? undefined : 'End before start'}>
              <input
                type="date"
                className="input"
                value={custom.to}
                min={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </Field>
          </>
        )}
      </div>
      {!validRange ? (
        <ErrorBox error="Choose a start date before the end date." />
      ) : tab === 'leads' ? (
        <LeadReport from={range.from} to={range.to} />
      ) : (
        <ProjectReport from={instant(range.from)} to={instant(range.to)} />
      )}
    </>
  );
}

/* ───────────────────────── Lead report ───────────────────────── */

function LeadReport({ from, to }: { from: string; to: string }) {
  const team = useTeam();
  const data = useLoad(async (s) => {
    const [stages, leads, facts, days, sources] = await Promise.all([
      get<Stage[]>('/lead-stages', s),
      get<Lead[]>('/leads', s),
      get<Fact[]>('/reports/lead-facts', s),
      get<StageDay[]>('/reports/lead-stage-days', s),
      get<SourceRow[]>('/reports/lead-sources', s),
    ]);
    return { stages, leads, facts, days, sources };
  }, []);
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');

  const report = useMemo(() => {
    if (!data.data) return null;
    const { stages, leads, facts, days } = data.data;
    const fromT = new Date(`${from}T00:00:00`).getTime();
    const toT = new Date(`${to}T00:00:00`).getTime();
    const inRange = leads.filter((l) => {
      const t = new Date(l.created_at).getTime();
      return t >= fromT && t < toT && (!owner || l.data.ownerId === owner) && (!source || (l.data.source || 'Not set') === source);
    });
    const ids = new Set(inRange.map((l) => l.id));
    const factMap = new Map(facts.filter((f) => ids.has(f.lead_id)).map((f) => [f.lead_id, f]));
    const ordered = [...stages].sort((a, b) => a.position - b.position);
    const openStages = ordered.filter((s) => s.kind === 'open');
    const won = inRange.filter((l) => l.state === 'won').length;
    const funnel = openStages.map((s, i) => {
      const later = new Set(openStages.slice(i).map((x) => x.id));
      const count = inRange.filter((l) => l.state === 'won' || (factMap.get(l.id)?.reached ?? [l.stage]).some((r) => later.has(r))).length;
      return { id: s.id, label: s.label, color: s.color, count };
    });
    funnel.push({ id: 'won', label: 'Won', color: '#2f5d50', count: won });

    const timing = ordered.map((s) => {
      const vals = days.filter((d) => ids.has(d.leadId) && d.stage === s.id).map((d) => d.days);
      const perLead = new Map<string, number>();
      days
        .filter((d) => ids.has(d.leadId) && d.stage === s.id)
        .forEach((d) => perLead.set(d.leadId, (perLead.get(d.leadId) ?? 0) + d.days));
      const totals = [...perLead.values()].sort((a, b) => a - b);
      const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
      const median = totals.length ? totals[Math.floor(totals.length / 2)]! : null;
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        leads: totals.length,
        avg,
        median,
        entries: vals.length,
      };
    });

    const bySource = new Map<string, { total: number; won: number; active: number; dropped: number }>();
    for (const l of inRange) {
      const k = l.data.source?.trim() || 'Not set';
      const row = bySource.get(k) ?? { total: 0, won: 0, active: 0, dropped: 0 };
      row.total++;
      if (l.state === 'won') row.won++;
      if (l.state === 'active') row.active++;
      if (l.state === 'dropped') row.dropped++;
      bySource.set(k, row);
    }
    const calls = [...factMap.values()].reduce(
      (a, f) => ({
        booked: a.booked + f.booked,
        attended: a.attended + f.attended,
        noShow: a.noShow + f.no_show,
      }),
      { booked: 0, attended: 0, noShow: 0 },
    );
    const allSources = [...new Set(leads.map((l) => l.data.source?.trim() || 'Not set'))].sort();
    return {
      total: inRange.length,
      won,
      active: inRange.filter((l) => l.state === 'active').length,
      dropped: inRange.filter((l) => l.state === 'dropped').length,
      funnel,
      timing,
      sources: [...bySource.entries()].sort((a, b) => b[1].total - a[1].total),
      calls,
      allSources,
    };
  }, [data.data, from, to, owner, source]);

  if (data.error) return <ErrorBox error={data.error} retry={data.reload} />;
  if (!report || !data.data) return <Spinner />;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const maxFunnel = Math.max(1, ...report.funnel.map((f) => f.count));
  const maxDays = Math.max(1, ...report.timing.map((t) => t.avg ?? 0));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Owner">
          <select className="input w-48" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Everyone</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select className="input w-48" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {report.allSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="New leads" value={report.total} />
        <Stat label="Won" value={report.won} hint={`Win rate ${pct(report.won, report.total)}`} />
        <Stat label="Still open" value={report.active} />
        <Stat label="Archived" value={report.dropped} />
        <Stat
          label="Calls attended"
          value={`${report.calls.attended}/${report.calls.booked}`}
          hint={`${report.calls.noShow} no-show${report.calls.noShow === 1 ? '' : 's'} · ${pct(report.calls.noShow, report.calls.booked)}`}
          tone={report.calls.noShow ? 'warn' : undefined}
        />
      </div>

      {report.total === 0 ? (
        <Card>
          <Empty title="No leads in this period" description="Pick a longer period or clear the filters." />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Pipeline funnel" action={<span className="text-xs text-mute">Leads that reached each stage</span>}>
            <ul className="space-y-2.5">
              {report.funnel.map((f, i) => (
                <li key={f.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{f.label}</span>
                    <span className="tabular-nums text-mute">
                      {f.count}
                      {i > 0 && <span className="ml-2 text-xs">{pct(f.count, report.funnel[0]!.count)}</span>}
                    </span>
                  </div>
                  <Bar value={f.count} max={maxFunnel} color={f.color} label={`${f.label}: ${f.count}`} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Time in stage" action={<span className="text-xs text-mute">Average days per lead</span>}>
            <ul className="space-y-2.5">
              {report.timing.map((t) => (
                <li key={t.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{t.label}</span>
                    <span className="tabular-nums text-mute">
                      {t.avg === null ? '—' : `${t.avg.toFixed(1)} d`}
                      {t.median !== null && <span className="ml-2 text-xs">median {t.median.toFixed(1)}</span>}
                    </span>
                  </div>
                  <Bar value={t.avg ?? 0} max={maxDays} color={t.color} label={`${t.label}: ${t.avg?.toFixed(1) ?? 0} days`} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Lead sources" bodyClassName="p-0" className="lg:col-span-2">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Open</th>
                    <th className="text-right">Archived</th>
                    <th className="text-right">Won</th>
                    <th className="text-right">Win rate</th>
                    <th className="w-1/3">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sources.map(([name, r]) => (
                    <tr key={name}>
                      <td className="font-medium">{name}</td>
                      <td className="text-right tabular-nums">{r.total}</td>
                      <td className="text-right tabular-nums">{r.active}</td>
                      <td className="text-right tabular-nums">{r.dropped}</td>
                      <td className="text-right tabular-nums">{r.won}</td>
                      <td className="text-right tabular-nums">{pct(r.won, r.total)}</td>
                      <td>
                        <Bar value={r.total} max={report.total} label={`${name}: ${pct(r.total, report.total)}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      <Card title="Projects by source" bodyClassName="p-0" action={<span className="text-xs text-mute">All time</span>}>
        {data.data.sources.length === 0 ? (
          <Empty title="No projects yet" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="text-right">Projects</th>
                <th className="text-right">Booked work</th>
              </tr>
            </thead>
            <tbody>
              {data.data.sources.map((s) => (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td className="text-right tabular-nums">{s.projects}</td>
                  <td className="text-right tabular-nums">{s.booked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Bar({ value, max, color, label }: { value: number; max: number; color?: string; label: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-subtle" role="img" aria-label={label}>
      <div className={cn('h-full rounded-full', !color && 'bg-acc')} style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

/* ───────────────────────── Project report ───────────────────────── */

interface ProjectRow {
  id: string;
  name: string;
  clientName: string;
  stageLabel: string;
  category: string;
  value: number;
  currency: string;
  daysInStage: number;
  milestones: number;
  done: number;
  overdueMilestones: number;
  overdueTasks: number;
  daysSinceMeeting: number | null;
  invoiced: number;
  collected: number;
  outstanding: number;
}
interface ProjectReportData {
  currency: string;
  stages: {
    id: string;
    label: string;
    color: string;
    category: string;
    count: number;
    avg_days: number | null;
  }[];
  activeProjects: number;
  activeValue: number;
  newFromWon: number;
  newProjects: number;
  wentLive: number;
  milestonesDue: number;
  milestonesOnTime: number;
  closeToLiveDays: number | null;
  outstanding: number;
  health: (ProjectRow & { flags: { text: string; tone: 'red' | 'amber' }[] })[];
  milestonesDueThisWeek: number;
  milestonesOverdue: number;
  money: {
    id: string;
    name: string;
    clientName: string;
    value: number;
    invoiced: number;
    collected: number;
  }[];
  aging: { dueThisMonth: number; days30: number; days60: number; days60plus: number };
  support: {
    id: string;
    name: string;
    clientName: string;
    endsOn: string | null;
    daysLeft: number | null;
  }[];
  repeatClients: { id: string; name: string; projects: number }[];
  projects: ProjectRow[];
}

function ProjectReport({ from, to }: { from: string; to: string }) {
  const query = qs({ from, to });
  const r = useLoad((s) => get<ProjectReportData>(`/reports/projects${query}`, s), [query]);
  const [view, setView] = useState<'health' | 'all'>('health');
  if (r.error) return <ErrorBox error={r.error} retry={r.reload} />;
  if (!r.data) return <Spinner />;
  const d = r.data;
  const c = d.currency;
  const maxStage = Math.max(1, ...d.stages.map((s) => s.count));
  const agingTotal = d.aging.dueThisMonth + d.aging.days30 + d.aging.days60 + d.aging.days60plus;
  const onTime = d.milestonesDue ? Math.round((d.milestonesOnTime / d.milestonesDue) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <a
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-3.5 text-sm font-medium hover:bg-subtle"
          href={`/api/reports/projects.csv${query}`}
        >
          <Download className="h-4 w-4" /> Export CSV
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active projects" value={d.activeProjects} hint={money(d.activeValue, c)} />
        <Stat label="New in period" value={d.newProjects} hint={`${d.newFromWon} from won leads`} />
        <Stat
          label="Went live"
          value={d.wentLive}
          hint={d.closeToLiveDays === null ? 'Close-to-live: —' : `Close-to-live ${Math.round(d.closeToLiveDays)} days avg`}
        />
        <Stat
          label="Milestones on time"
          value={onTime === null ? '—' : `${onTime}%`}
          hint={`${d.milestonesOnTime} of ${d.milestonesDue} due in period`}
        />
        <Stat label="Outstanding" value={money(d.outstanding, c)} tone={d.outstanding ? 'warn' : undefined} />
        <Stat label="Milestones due this week" value={d.milestonesDueThisWeek} />
        <Stat label="Milestones overdue" value={d.milestonesOverdue} tone={d.milestonesOverdue ? 'danger' : undefined} />
        <Stat label="Repeat clients" value={d.repeatClients.length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Projects by stage">
          <ul className="space-y-2.5">
            {d.stages.map((s) => (
              <li key={s.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="tabular-nums text-mute">
                    {s.count}
                    {s.avg_days !== null && <span className="ml-2 text-xs">{s.avg_days.toFixed(1)} d avg</span>}
                  </span>
                </div>
                <Bar value={s.count} max={maxStage} color={s.color} label={`${s.label}: ${s.count}`} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Receivables aging" action={<span className="text-xs text-mute">{money(agingTotal, c)} open</span>}>
          <ul className="space-y-2.5">
            {(
              [
                ['Due this month', d.aging.dueThisMonth, undefined],
                ['1–30 days late', d.aging.days30, 'var(--warn)'],
                ['31–60 days late', d.aging.days60, 'var(--danger)'],
                ['Over 60 days late', d.aging.days60plus, 'var(--danger)'],
              ] as const
            ).map(([label, v, color]) => (
              <li key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular-nums">{money(v, c)}</span>
                </div>
                <Bar value={v} max={Math.max(agingTotal, 1)} color={color} label={`${label}: ${money(v, c)}`} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        title="Delivery health"
        bodyClassName="p-0"
        action={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'health', label: `Needs attention (${d.health.length})` },
              { value: 'all', label: 'All projects' },
            ]}
          />
        }
      >
        {view === 'health' ? (
          d.health.length === 0 ? (
            <Empty title="Everything is on track" description="No overdue milestones, overdue tasks or quiet projects." />
          ) : (
            <ul className="divide-y divide-line">
              {d.health.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-warn" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-mute">
                      {p.clientName} · {p.stageLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.flags.map((f) => (
                      <Badge key={f.text} tone={f.tone === 'red' ? 'danger' : 'warn'}>
                        {f.text}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Stage</th>
                  <th className="text-right">Milestones</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">Invoiced</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {d.projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-xs text-mute">{p.clientName}</p>
                    </td>
                    <td className="whitespace-nowrap">
                      {p.stageLabel}
                      <p className="text-xs text-mute">{p.daysInStage} d</p>
                    </td>
                    <td className="text-right tabular-nums">
                      {p.done}/{p.milestones}
                      {p.overdueMilestones > 0 && <p className="text-xs text-danger">{p.overdueMilestones} overdue</p>}
                    </td>
                    <td className="text-right tabular-nums">{money(p.value, p.currency)}</td>
                    <td className="text-right tabular-nums">{money(p.invoiced, p.currency)}</td>
                    <td className="text-right tabular-nums">{money(p.collected, p.currency)}</td>
                    <td className="text-right tabular-nums">{money(p.outstanding, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Value vs collected" bodyClassName="p-0">
          {d.money.length === 0 ? (
            <Empty title="No project value yet" />
          ) : (
            <ul className="divide-y divide-line">
              {d.money.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="mb-1.5 flex justify-between gap-3 text-sm">
                    <Link href={`/projects/${m.id}`} className="truncate font-medium hover:underline">
                      {m.name}
                    </Link>
                    <span className="shrink-0 text-xs text-mute tabular-nums">
                      {money(m.collected, c)} of {money(m.value, c)}
                    </span>
                  </div>
                  <div
                    className="relative h-2.5 overflow-hidden rounded-full bg-subtle"
                    role="img"
                    aria-label={`${m.name}: invoiced ${money(m.invoiced, c)}, collected ${money(m.collected, c)}`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-acc-soft"
                      style={{
                        width: `${m.value ? Math.min(100, (m.invoiced / m.value) * 100) : 0}%`,
                      }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-acc"
                      style={{
                        width: `${m.value ? Math.min(100, (m.collected / m.value) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-5">
          <Card title="Support periods ending" bodyClassName="p-0">
            {d.support.length === 0 ? (
              <p className="px-4 py-4 text-sm text-mute">No projects are in a support milestone.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.support.map((s) => (
                  <li key={s.id} className="flex justify-between px-4 py-2.5 text-sm">
                    <Link href={`/projects/${s.id}`} className="hover:underline">
                      {s.name}
                    </Link>
                    <span className={cn('tabular-nums', s.daysLeft !== null && s.daysLeft < 14 ? 'text-warn' : 'text-mute')}>
                      {s.daysLeft === null ? 'No end date' : `${s.daysLeft} days left`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Repeat clients" bodyClassName="p-0">
            {d.repeatClients.length === 0 ? (
              <p className="px-4 py-4 text-sm text-mute">No client has more than one project yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.repeatClients.map((rc) => (
                  <li key={rc.id} className="flex justify-between px-4 py-2.5 text-sm">
                    <span>{rc.name}</span>
                    <span className="text-mute tabular-nums">{rc.projects} projects</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
