'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, UserPlus } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Button, PageHeader, Spinner, Tabs } from '@/components/ui';
import { Overview } from '@/components/nurtures/Overview';
import { GeneralList } from '@/components/nurtures/GeneralList';
import { Tracking } from '@/components/nurtures/Tracking';
import { Discarded } from '@/components/nurtures/Discarded';
import { ImportModal } from '@/components/nurtures/ImportModal';

type Tab = 'overview' | 'general' | 'tracking' | 'discard';
const TABS: Tab[] = ['overview', 'general', 'tracking', 'discard'];

function Nurtures() {
  const router = useRouter();
  const search = useSearchParams();
  const raw = search.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'overview';
  const [version, setVersion] = useState(0);
  const [importing, setImporting] = useState(false);
  const counts = useLoad((s) => get<{ general: number; tracking: number; discard: number }>('/nurtures/counts', s), [version]);
  const changed = () => setVersion((v) => v + 1);

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Nurtures"
        description="Keep in touch with leads who are not ready yet. Park them, run a gentle email sequence, and bring them back when they reply."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <UserPlus className="h-4 w-4" /> Add leads
            </Button>
            <Link href="/nurtures/sequences/new">
              <Button>
                <Plus className="h-4 w-4" /> New sequence
              </Button>
            </Link>
          </>
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(t) => router.replace(t === 'overview' ? '/nurtures' : `/nurtures?tab=${t}`, { scroll: false })}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'general', label: 'General', count: counts.data?.general },
          { value: 'tracking', label: 'In sequence', count: counts.data?.tracking },
          { value: 'discard', label: 'Discard', count: counts.data?.discard },
        ]}
      />
      {tab === 'overview' && <Overview version={version} />}
      {tab === 'general' && <GeneralList version={version} onChanged={changed} />}
      {tab === 'tracking' && <Tracking version={version} onChanged={changed} />}
      {tab === 'discard' && <Discarded version={version} onChanged={changed} />}
      <ImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onDone={() => {
          changed();
          if (tab !== 'general') router.replace('/nurtures?tab=general', { scroll: false });
        }}
      />
    </>
  );
}

export default function NurturesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Nurtures />
    </Suspense>
  );
}
