'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FileText, Plus, Repeat, Search } from 'lucide-react';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Menu,
  PageHeader,
  Spinner,
  Stat,
  Tabs,
  useToast,
} from '@/components/ui';
import { get, patch } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useSession } from '@/lib/session';
import { date, money } from '@/lib/format';
import { InvoiceStatusBadge } from '@/components/money/StatusBadge';
import type { Invoice, InvoiceStatus, RecurringSchedule } from '@/components/money/types';
import { ScheduleTable } from '@/components/money/ScheduleTable';

type Filter = 'all' | InvoiceStatus | 'recurring';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
  { value: 'recurring', label: 'Recurring' },
];

export default function InvoicesPage() {
  const router = useRouter();
  const { currency } = useSession();
  const invoices = useLoad((s) => get<Invoice[]>('/invoices', s), []);
  const schedules = useLoad((s) => get<RecurringSchedule[]>('/recurring-invoices', s), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const list = useMemo(() => invoices.data ?? [], [invoices.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.length, recurring: schedules.data?.length ?? 0 };
    for (const i of list) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [list, schedules.data]);
  const totals = useMemo(() => {
    const live = list.filter(
      (i) => i.currency === currency && i.status !== 'draft' && i.status !== 'void',
    );
    return {
      outstanding: live.reduce((a, i) => a + i.balance, 0),
      overdue: live.reduce(
        (a, i) =>
          a +
          i.installments.filter((x) => x.status === 'overdue').reduce((s, x) => s + x.balance, 0),
        0,
      ),
      collected: live.reduce((a, i) => a + i.paid, 0),
      invoiced: live.reduce((a, i) => a + i.total, 0),
    };
  }, [list, currency]);
  const shown = list.filter((i) => {
    if (filter !== 'all' && i.status !== filter) return false;
    const term = q.trim().toLowerCase();
    return (
      !term ||
      [i.number, i.title, i.project_name, i.client_name].some((v) =>
        v?.toLowerCase().includes(term),
      )
    );
  });

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Invoices"
        description="GST invoices, part payments, instalments and recurring drafts."
        actions={
          <>
            <Menu
              trigger={(open) => (
                <Button variant="secondary" onClick={open}>
                  <Download className="h-4 w-4" /> Export
                </Button>
              )}
              items={[
                {
                  label: 'Invoices (CSV)',
                  onSelect: () => window.open('/api/exports/invoices.csv', '_blank'),
                },
                {
                  label: 'Payments (CSV)',
                  onSelect: () => window.open('/api/exports/payments.csv', '_blank'),
                },
              ]}
            />
            <Button onClick={() => router.push('/invoices/new')}>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Invoiced"
          value={money(totals.invoiced, currency)}
          hint="Published, not void"
        />
        <Stat label="Collected" value={money(totals.collected, currency)} />
        <Stat
          label="Outstanding"
          value={money(totals.outstanding, currency)}
          tone={totals.outstanding ? 'warn' : undefined}
        />
        <Stat
          label="Overdue"
          value={money(totals.overdue, currency)}
          tone={totals.overdue ? 'danger' : undefined}
        />
      </div>
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-2">
          <Tabs
            className="flex-1 border-b-0"
            tabs={FILTERS.map((f) => ({ ...f, count: counts[f.value] ?? 0 }))}
            value={filter}
            onChange={setFilter}
          />
          {filter !== 'recurring' && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
              <input
                aria-label="Search invoices"
                className="input pl-9"
                placeholder="Number, client or project"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="border-t border-line">
          {filter === 'recurring' ? (
            <RecurringList state={schedules} />
          ) : invoices.error ? (
            <div className="p-4">
              <ErrorBox error={invoices.error} retry={invoices.reload} />
            </div>
          ) : invoices.loading && !invoices.data ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <Empty
              icon={<FileText className="h-5 w-5" />}
              title={list.length ? 'No invoices match' : 'No invoices yet'}
              description={
                list.length
                  ? 'Try another filter or search.'
                  : 'Create an invoice for a project to bill your client.'
              }
              action={
                !list.length && (
                  <Button onClick={() => router.push('/invoices/new')}>New invoice</Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client · project</th>
                    <th>Status</th>
                    <th>Next due</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr
                      key={i.id}
                      className="clickable"
                      onClick={() => router.push(`/invoices/${i.id}`)}
                    >
                      <td>
                        <Link
                          href={`/invoices/${i.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {i.number}
                        </Link>
                        <p className="max-w-64 truncate text-xs text-mute">{i.title}</p>
                      </td>
                      <td>
                        <p className="max-w-56 truncate">{i.client_name}</p>
                        <p className="max-w-56 truncate text-xs text-mute">{i.project_name}</p>
                      </td>
                      <td>
                        <InvoiceStatusBadge status={i.status} />
                      </td>
                      <td className="whitespace-nowrap text-mute">
                        {i.status === 'paid' || i.status === 'void'
                          ? '—'
                          : date(i.next_payment_due ?? i.due_date)}
                      </td>
                      <td className="text-right tabular-nums">{money(i.total, i.currency)}</td>
                      <td className="text-right font-medium tabular-nums">
                        {i.status === 'draft' ? '—' : money(i.balance, i.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function RecurringList({ state }: { state: ReturnType<typeof useLoad<RecurringSchedule[]>> }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (state.error)
    return (
      <div className="p-4">
        <ErrorBox error={state.error} retry={state.reload} />
      </div>
    );
  if (!state.data) return <Spinner />;
  if (!state.data.length)
    return (
      <Empty
        icon={<Repeat className="h-5 w-5" />}
        title="No recurring schedules"
        description="Open an invoice and choose “Repeat” to create drafts on a schedule."
      />
    );
  const change = async (s: RecurringSchedule, next: 'active' | 'paused' | 'cancelled') => {
    setBusy(s.id);
    try {
      await patch(`/recurring-invoices/${s.id}`, { state: next });
      toast.success(`Schedule ${next === 'active' ? 'resumed' : next}.`);
      await state.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return <ScheduleTable schedules={state.data} busy={busy} onChange={change} />;
}
