import Link from 'next/link';
import { MapPin, Phone, Users, Video } from 'lucide-react';
import { Badge } from '@/components/ui';
import { time } from '@/lib/format';
import { outcomeLabel } from './util';

export interface MeetingLike {
  id: string;
  title: string;
  kind: string;
  start_at: string;
  duration_minutes: number;
  status?: string;
  source?: string;
  outcome?: string | null;
  meeting_url?: string;
  location?: string;
  target_name?: string | null;
  lead_name?: string | null;
  project_name?: string | null;
  participant_count?: number;
}

export function KindIcon({ kind, className = 'h-4 w-4' }: { kind: string; className?: string }) {
  return kind === 'phone' ? <Phone className={className} /> : kind === 'in_person' ? <MapPin className={className} /> : <Video className={className} />;
}

/** Compact meeting row: time block, title, who it's with and status. */
export function MeetingItem({ m, showDate = false, needsOutcome = false }: { m: MeetingLike; showDate?: boolean; needsOutcome?: boolean }) {
  const start = new Date(m.start_at);
  const withName = m.target_name ?? m.project_name ?? m.lead_name;
  return (
    <Link href={`/meetings/${m.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle">
      <div className="w-16 shrink-0 text-center">
        {showDate && <p className="text-[11px] font-medium text-mute uppercase">{start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
        <p className="text-sm font-semibold">{m.source === 'upload' ? '—' : time(m.start_at)}</p>
        {!showDate && <p className="text-[11px] text-faint">{m.duration_minutes} min</p>}
      </div>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acc-soft text-acc">
        <KindIcon kind={m.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={m.status === 'cancelled' ? 'truncate text-sm font-medium text-mute line-through' : 'truncate text-sm font-medium'}>{m.title}</p>
        <p className="truncate text-xs text-mute">
          {withName ? `${m.project_name ? 'Project' : m.lead_name ? 'Lead' : 'With'} · ${withName}` : 'No link'}
          {m.participant_count ? (
            <>
              {' · '}
              <Users className="inline h-3 w-3 -translate-y-px" /> {m.participant_count}
            </>
          ) : null}
        </p>
      </div>
      <div className="hidden shrink-0 gap-1 sm:flex">
        {m.status === 'cancelled' && <Badge>Cancelled</Badge>}
        {m.source === 'upload' && <Badge tone="info">Notes</Badge>}
        {m.source === 'booking' && <Badge tone="violet">Booked</Badge>}
        {m.outcome && <Badge tone={m.outcome === 'attended' ? 'ok' : 'warn'}>{outcomeLabel(m.outcome)}</Badge>}
        {needsOutcome && !m.outcome && <Badge tone="warn">Record outcome</Badge>}
      </div>
    </Link>
  );
}
