'use client';
import Link from 'next/link';
import { ArrowRight, Briefcase } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date } from '@/lib/format';
import { Empty, ErrorBox, PageHeader, Skeleton } from '@/components/ui';
import { StageDot } from '@/components/projects/StageDot';

interface PortalProject {
  id: string;
  name: string;
  stage_label: string;
  stage_color: string;
  stage_category: string;
  progress: number;
  due_date: string | null;
  updated_at: string;
}

export default function PortalHome() {
  const { user } = useSession();
  const { data, error, loading, reload } = useLoad((s) => get<PortalProject[]>('/portal/projects', s), []);
  return (
    <div>
      <PageHeader
        eyebrow="Welcome"
        title={`Hello, ${user?.name.split(' ')[0] ?? ''}`}
        description="Follow progress, review documents, see invoices and message the team."
      />
      {error ? (
        <ErrorBox error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !data?.length ? (
        <div className="card">
          <Empty
            icon={<Briefcase className="h-5 w-5" />}
            title="No projects yet"
            description="When the team shares a project with you, it appears here."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((p) => (
            <Link key={p.id} href={`/portal/projects/${p.id}`} className="card group block p-5 transition hover:border-acc/40">
              <div className="flex items-start gap-2">
                <p className="flex-1 font-semibold">{p.name}</p>
                <ArrowRight className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-acc" />
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-mute">
                <StageDot color={p.stage_color} label={p.stage_label} />
                {p.due_date && <span>Target {date(p.due_date)}</span>}
              </div>
              {p.progress > 0 && (
                <>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full rounded-full bg-acc" style={{ width: `${p.progress}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-faint">{p.progress}% complete</p>
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
