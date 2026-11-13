'use client';
import { useState } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorBox, Spinner } from '@/components/ui';
import { get, qs } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { dateTime, relative, titleCase } from '@/lib/format';
import { Section } from './shared';

interface AuditRow {
  id: number;
  actor_name: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  summary: string;
  created_at: string;
}
interface JobRow {
  job: string;
  last_run_at: string | null;
  last_error: string | null;
}

const ENTITIES = [
  '',
  'user',
  'settings',
  'contact',
  'lead_stage',
  'project_stage',
  'lead_option',
  'project',
  'invoice',
];

export function AuditLog() {
  const [entity, setEntity] = useState('');
  const log = useLoad((s) => get<AuditRow[]>(`/audit-log${qs({ entity })}`, s), [entity]);
  return (
    <Section
      title="Audit log"
      description="The latest 200 administrative changes: team access, settings, stages and records."
      actions={
        <select
          aria-label="Filter by record type"
          className="input w-48"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e ? titleCase(e) : 'All record types'}
            </option>
          ))}
        </select>
      }
    >
      <Card bodyClassName="p-0">
        {log.error ? (
          <div className="p-4">
            <ErrorBox error={log.error} retry={log.reload} />
          </div>
        ) : !log.data ? (
          <Spinner />
        ) : log.data.length === 0 ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Change</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {log.data.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-mute" title={dateTime(r.created_at)}>
                      {relative(r.created_at)}
                    </td>
                    <td className="whitespace-nowrap">{r.actor_name ?? 'System'}</td>
                    <td>{r.summary}</td>
                    <td>
                      <Badge>
                        {titleCase(r.entity)} · {r.action}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}

const JOB_LABEL: Record<string, string> = {
  'mail-outbox': 'Email delivery (local SMTP)',
  reminders: 'Reminders',
  'recurring-invoices': 'Recurring invoice drafts',
  'record-outcome-tasks': 'Meeting outcome follow-ups',
};

export function JobStatus() {
  // Staleness is judged at load time so rendering stays pure.
  const jobs = useLoad(async (s) => {
    const rows = await get<JobRow[]>('/jobs/status', s);
    const now = Date.now();
    return rows.map((j) => ({
      ...j,
      stale: !j.last_run_at || now - new Date(j.last_run_at).getTime() > 10 * 60_000,
    }));
  }, []);
  return (
    <Section
      title="Background jobs"
      description="The worker runs every minute inside the API process. A job that has not run recently means the worker is stopped."
      actions={
        <Button variant="secondary" onClick={jobs.reload} loading={jobs.loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      }
    >
      <Card bodyClassName="p-0">
        {jobs.error ? (
          <div className="p-4">
            <ErrorBox error={jobs.error} retry={jobs.reload} />
          </div>
        ) : !jobs.data ? (
          <Spinner />
        ) : jobs.data.length === 0 ? (
          <Empty title="No job has run yet" description="Start the API with the worker enabled." />
        ) : (
          <ul className="divide-y divide-line">
            {jobs.data.map((j) => {
              const stale = j.stale;
              return (
                <li key={j.job} className="flex items-start gap-3 px-4 py-3">
                  {j.last_error ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 text-danger" />
                  ) : (
                    <CheckCircle2
                      className={stale ? 'mt-0.5 h-4 w-4 text-warn' : 'mt-0.5 h-4 w-4 text-ok'}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{JOB_LABEL[j.job] ?? j.job}</p>
                    {j.last_error && (
                      <p className="mt-0.5 text-xs break-words text-danger">{j.last_error}</p>
                    )}
                  </div>
                  <span
                    className="text-xs whitespace-nowrap text-mute"
                    title={dateTime(j.last_run_at)}
                  >
                    {j.last_run_at ? `Ran ${relative(j.last_run_at)}` : 'Never'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Section>
  );
}
