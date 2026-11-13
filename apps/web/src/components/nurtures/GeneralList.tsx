'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { NURTURE_TAG_LABELS } from '@know-crm/shared';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { date, relative } from '@/lib/format';
import { Badge, Button, Empty, ErrorBox, Spinner } from '@/components/ui';
import { AssignModal } from './AssignModal';
import { DiscardModal } from './DiscardModal';
import { SOURCE_LABELS, type GeneralLead, type SequenceSummary } from './types';

export function GeneralList({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(
    (s) => get<{ leads: GeneralLead[]; sequences: SequenceSummary[] }>('/nurtures/general', s),
    [version],
  );
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<string[]>([]);
  const [discard, setDiscard] = useState<{ id: string; name: string }[]>([]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.leads ?? []).filter((l) => !term || [l.name, l.email, l.company, l.industry].some((v) => v?.toLowerCase().includes(term)));
  }, [data, q]);
  const done = () => {
    setSelected(new Set());
    setAssign([]);
    setDiscard([]);
    onChanged();
  };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  const all = list.length > 0 && list.every((l) => selected.has(l.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const picked = (data?.leads ?? []).filter((l) => selected.has(l.id));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search name, company, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        <span className="flex-1" />
        {picked.length > 0 && (
          <>
            <span className="text-sm text-mute">{picked.length} selected</span>
            <Button size="sm" onClick={() => setAssign(picked.map((l) => l.id))}>
              Add to sequence
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDiscard(picked.map((l) => ({ id: l.id, name: l.name })))}>
              Discard
            </Button>
          </>
        )}
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty
            title={q ? 'No matches' : 'The General list is empty'}
            description={q ? undefined : 'Leads parked from the pipeline, imported, or restored from Discard wait here until you add them to a sequence.'}
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={() => setSelected(all ? new Set() : new Set(list.map((l) => l.id)))}
                    aria-label="Select all"
                    className="h-4 w-4 accent-[var(--acc)]"
                  />
                </th>
                <th>Lead</th>
                <th className="hidden md:table-cell">Why parked</th>
                <th className="hidden lg:table-cell">Source</th>
                <th className="hidden sm:table-cell">Revisit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                      aria-label={`Select ${l.name}`}
                      className="h-4 w-4 accent-[var(--acc)]"
                    />
                  </td>
                  <td>
                    <Link href={`/nurtures/leads/${l.id}`} className="font-medium hover:text-acc">
                      {l.name}
                    </Link>
                    <p className="text-xs text-mute">{[l.company, l.email].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="hidden max-w-xs md:table-cell">
                    <p className="truncate text-sm">{l.reason || '—'}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {l.tags.map((t) => (
                        <Badge key={t}>{NURTURE_TAG_LABELS[t] ?? t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="hidden text-sm text-mute lg:table-cell">
                    {SOURCE_LABELS[l.source ?? ''] ?? l.source ?? '—'}
                    <p className="text-xs text-faint">{relative(l.entered_at)}</p>
                  </td>
                  <td className="hidden text-sm sm:table-cell">{l.revisit_date ? date(l.revisit_date) : '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="soft" onClick={() => setAssign([l.id])}>
                      Start sequence
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AssignModal leadIds={assign} sequences={data?.sequences ?? []} onClose={() => setAssign([])} onDone={done} />
      <DiscardModal leads={discard} onClose={() => setDiscard([])} onDone={done} />
    </>
  );
}
