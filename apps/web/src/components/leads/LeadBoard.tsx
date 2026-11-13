'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Building2, Flame, Snowflake } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/format';
import { withDefaults, type Lead, type Stage } from './types';

/** Kanban of active leads by open stage, plus a closed-won drop zone. */
export function LeadBoard({
  leads,
  stages,
  onMove,
  busyId,
}: {
  leads: Lead[];
  stages: Stage[];
  onMove: (lead: Lead, stage: Stage) => void;
  busyId: string | null;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const open = stages.filter((s) => s.kind === 'open');
  const won = stages.find((s) => s.kind === 'won');
  const columns = won ? [...open, won] : open;

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {columns.map((stage) => {
          const items = stage.kind === 'won' ? [] : leads.filter((l) => l.stage === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={stage.label}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const lead = leads.find((l) => l.id === dragId);
                setDragId(null);
                setOver(null);
                if (lead && lead.stage !== stage.id) onMove(lead, stage);
              }}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-[14px] border bg-subtle/60 transition',
                over === stage.id ? 'border-acc bg-acc-soft/60' : 'border-line',
              )}
            >
              <header className="flex items-center gap-2 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
                <h2 className="flex-1 truncate text-sm font-semibold">{stage.label}</h2>
                {stage.kind === 'open' && <span className="text-xs text-mute">{items.length}</span>}
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {stage.kind === 'won' ? (
                  <p className="m-1 rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-mute">
                    Drop a lead here to close it won and create its project.
                  </p>
                ) : items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-faint">No leads</p>
                ) : (
                  items.map((lead) => <LeadCard key={lead.id} lead={lead} busy={busyId === lead.id} onDrag={setDragId} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LeadCard({ lead, busy, onDrag }: { lead: Lead; busy: boolean; onDrag: (id: string | null) => void }) {
  const d = withDefaults(lead.data);
  return (
    <Link
      href={`/leads/${lead.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDrag(lead.id);
      }}
      onDragEnd={() => onDrag(null)}
      className={cn(
        'block rounded-xl border border-line bg-card p-3 shadow-sm transition hover:border-acc/40',
        busy && 'pointer-events-none opacity-50',
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{lead.name}</p>
        {d.temperature === 'cold' ? (
          <Snowflake className="h-3.5 w-3.5 shrink-0 text-info" aria-label="Cold" />
        ) : (
          <Flame className="h-3.5 w-3.5 shrink-0 text-warn" aria-label="Warm" />
        )}
      </div>
      {d.company && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-mute">
          <Building2 className="h-3 w-3" /> {d.company}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2 text-xs text-faint">
        {lead.owner_name ? <Avatar name={lead.owner_name} size="sm" /> : <span className="text-warn">No owner</span>}
        {d.source && <span className="truncate">{d.source}</span>}
        <span className="ml-auto whitespace-nowrap">{relative(lead.stage_changed_at)}</span>
      </div>
    </Link>
  );
}
