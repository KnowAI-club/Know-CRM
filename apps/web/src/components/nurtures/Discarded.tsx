'use client';
import { useState } from 'react';
import Link from 'next/link';
import { get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { relative } from '@/lib/format';
import { Button, Empty, ErrorBox, Spinner, useToast } from '@/components/ui';

interface Row {
  lead_id: string;
  name: string;
  email: string;
  company: string | null;
  discarded_at: string;
  discard_reason: string;
  sequence_name?: string;
}

export function Discarded({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad((s) => get<{ rows: Row[] }>('/nurtures/discard', s), [version]);
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (r: Row) => {
    setBusy(r.lead_id);
    try {
      await post(`/nurtures/leads/${r.lead_id}/restore`);
      toast.success(`${r.name} is back in the General list.`);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data?.rows.length)
    return (
      <div className="card">
        <Empty title="Discard is empty" description="Leads you discard from nurtures are kept here so they can be restored." />
      </div>
    );
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Lead</th>
            <th className="hidden md:table-cell">Reason</th>
            <th className="hidden sm:table-cell">Discarded</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.lead_id}>
              <td>
                <Link href={`/nurtures/leads/${r.lead_id}`} className="font-medium hover:text-acc">
                  {r.name}
                </Link>
                <p className="text-xs text-mute">{[r.company, r.email].filter(Boolean).join(' · ')}</p>
              </td>
              <td className="hidden md:table-cell">
                {r.discard_reason || '—'}
                {r.sequence_name && <p className="text-xs text-faint">Last sequence: {r.sequence_name}</p>}
              </td>
              <td className="hidden text-sm text-mute sm:table-cell">{relative(r.discarded_at)}</td>
              <td className="text-right">
                <Button size="sm" variant="secondary" loading={busy === r.lead_id} onClick={() => restore(r)}>
                  Restore
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
