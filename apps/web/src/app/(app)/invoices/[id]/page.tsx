'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Ban,
  CreditCard,
  Eye,
  MoreHorizontal,
  Pencil,
  Printer,
  Repeat,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@know-crm/shared';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Menu,
  PageHeader,
  Segmented,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { del, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { date, money } from '@/lib/format';
import { InvoiceEditor } from '@/components/money/InvoiceEditor';
import { InvoiceDocument } from '@/components/money/InvoiceDocument';
import { PaymentModal, ReasonModal, RecurringModal } from '@/components/money/InvoiceModals';
import { ScheduleTable } from '@/components/money/ScheduleTable';
import { InvoiceStatusBadge } from '@/components/money/StatusBadge';
import {
  INSTALLMENT_TONE,
  type Invoice,
  type Payment,
  type RecurringSchedule,
  type WorkspaceSettings,
} from '@/components/money/types';

// Printing shows only the invoice document, whatever layout surrounds it.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #invoice-print, #invoice-print * { visibility: visible !important; }
  #invoice-print { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; }
  @page { margin: 14mm; }
}`;

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const inv = useLoad((s) => get<Invoice>(`/invoices/${id}`, s), [id]);
  const settings = useLoad((s) => get<WorkspaceSettings>('/settings', s), []);
  const schedules = useLoad((s) => get<RecurringSchedule[]>('/recurring-invoices', s), []);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [modal, setModal] = useState<
    null | 'payment' | 'void' | 'recurring' | { reverse: Payment }
  >(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (inv.error) return <ErrorBox error={inv.error} retry={inv.reload} />;
  if (!inv.data || !settings.data) return <Spinner />;
  const invoice = inv.data;
  const billing = settings.data.data.billing;
  const isDraft = invoice.stored_status === 'draft';
  const mine = (schedules.data ?? []).filter((s) => s.source_invoice_id === invoice.id);
  const update = (next: Invoice) => inv.setData(next);

  const publish = async () => {
    if (
      !(await confirm({
        title: `Publish ${invoice.number}?`,
        description: 'The client sees it in their portal and it can no longer be edited.',
        confirmLabel: 'Publish',
      }))
    )
      return;
    setBusy('publish');
    try {
      update(await patch<Invoice>(`/invoices/${invoice.id}`, { status: 'sent' }));
      toast.success('Invoice published.');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: `Delete draft ${invoice.number}?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/invoices/${invoice.id}`);
      toast.success('Draft deleted.');
      router.replace('/invoices');
    } catch (e) {
      toast.error(e);
    }
  };
  const changeSchedule = async (s: RecurringSchedule, state: 'active' | 'paused' | 'cancelled') => {
    setBusy(s.id);
    try {
      await patch(`/recurring-invoices/${s.id}`, { state });
      await schedules.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const menu = [
    ...(invoice.status !== 'void'
      ? [
          {
            label: 'Repeat on a schedule',
            icon: <Repeat className="h-4 w-4" />,
            onSelect: () => setModal('recurring'),
          },
        ]
      : []),
    ...(isDraft
      ? [
          {
            label: 'Delete draft',
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            onSelect: remove,
          },
        ]
      : []),
    ...(invoice.stored_status === 'sent'
      ? [
          {
            label: 'Void invoice',
            icon: <Ban className="h-4 w-4" />,
            danger: true,
            disabled: invoice.paid > 0,
            onSelect: () => setModal('void'),
          },
        ]
      : []),
  ];

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <PageHeader
          back={{ href: '/invoices', label: 'Invoices' }}
          eyebrow={invoice.project_name}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {invoice.number} <InvoiceStatusBadge status={invoice.status} />
            </span>
          }
          description={invoice.title}
          actions={
            <>
              {isDraft && (
                <Segmented
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'edit', label: 'Edit', icon: <Pencil className="h-3.5 w-3.5" /> },
                    { value: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" /> },
                  ]}
                />
              )}
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print / PDF
              </Button>
              {isDraft && mode === 'preview' && (
                <Button onClick={publish} loading={busy === 'publish'}>
                  Publish
                </Button>
              )}
              {['sent', 'partial', 'overdue'].includes(invoice.status) && (
                <Button onClick={() => setModal('payment')}>
                  <CreditCard className="h-4 w-4" /> Record payment
                </Button>
              )}
              {menu.length > 0 && (
                <Menu
                  trigger={(open) => (
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label="More actions"
                      onClick={open}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  )}
                  items={menu}
                />
              )}
            </>
          }
        />
      </div>

      {isDraft && mode === 'edit' ? (
        <InvoiceEditor
          key={invoice.updated_at}
          projectId={invoice.project_id}
          currency={invoice.currency}
          invoice={invoice}
          billing={billing}
          onSaved={(next, published) => {
            update(next);
            if (!published) setMode('preview');
          }}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <InvoiceDocument invoice={invoice} billing={billing} workspaceName={settings.data.name} />
          <div className="no-print space-y-4">
            {!isDraft && (
              <Card title="Balance">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-mute">Total</dt>
                    <dd className="tabular-nums">{money(invoice.total, invoice.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mute">Received</dt>
                    <dd className="tabular-nums text-ok">
                      {money(invoice.paid, invoice.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>Outstanding</dt>
                    <dd className="tabular-nums">{money(invoice.balance, invoice.currency)}</dd>
                  </div>
                </dl>
                {invoice.total > 0 && (
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-subtle"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((invoice.paid / invoice.total) * 100)}
                    aria-label="Collected"
                  >
                    <div
                      className="h-full rounded-full bg-acc"
                      style={{ width: `${Math.min(100, (invoice.paid / invoice.total) * 100)}%` }}
                    />
                  </div>
                )}
              </Card>
            )}
            <Card title="Instalments" bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {invoice.installments.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.label}</p>
                      <p className="text-xs text-mute">
                        Due {date(i.due_date)}
                        {i.paid > 0 && i.balance > 0
                          ? ` · ${money(i.paid, invoice.currency)} paid`
                          : ''}
                      </p>
                    </div>
                    <span className="tabular-nums">{money(i.amount, invoice.currency)}</span>
                    {!isDraft && <Badge tone={INSTALLMENT_TONE[i.status]}>{i.status}</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
            {!isDraft && (
              <Card title="Payments" bodyClassName="p-0">
                {invoice.payments.length === 0 ? (
                  <Empty
                    title="No payments yet"
                    description="Record receipts as they arrive; part payments are fine."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {invoice.payments.map((p) => (
                      <li key={p.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p
                            className={
                              p.reversed ? 'font-medium text-mute line-through' : 'font-medium'
                            }
                          >
                            {money(p.amount, invoice.currency)}
                          </p>
                          <p className="text-xs text-mute">
                            {date(p.received_date)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                            {p.reference ? ` · ${p.reference}` : ''}
                          </p>
                          {p.reversed && (
                            <p className="text-xs text-danger">Reversed: {p.reversal_reason}</p>
                          )}
                          {p.recorded_by_name && (
                            <p className="text-xs text-faint">by {p.recorded_by_name}</p>
                          )}
                        </div>
                        {!p.reversed && invoice.status !== 'void' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setModal({ reverse: p })}
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Reverse
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {mine.length > 0 && (
              <Card title="Recurring schedules" bodyClassName="p-0">
                <ScheduleTable schedules={mine} busy={busy} onChange={changeSchedule} />
              </Card>
            )}
          </div>
        </div>
      )}

      {modal === 'payment' && (
        <PaymentModal
          invoice={invoice}
          onClose={() => setModal(null)}
          onSaved={(n) => {
            update(n);
            setModal(null);
          }}
        />
      )}
      {modal === 'recurring' && (
        <RecurringModal
          invoice={invoice}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void schedules.reload();
          }}
        />
      )}
      {modal === 'void' && (
        <ReasonModal
          title={`Void ${invoice.number}?`}
          description="Voiding keeps the record for audit but cancels the balance. This cannot be undone."
          confirmLabel="Void invoice"
          onClose={() => setModal(null)}
          action={async (reason) => {
            update(await post<Invoice>(`/invoices/${invoice.id}/void`, { reason }));
            toast.success('Invoice voided.');
            setModal(null);
          }}
        />
      )}
      {modal && typeof modal === 'object' && (
        <ReasonModal
          title={`Reverse ${money(modal.reverse.amount, invoice.currency)}?`}
          description="Use this for bounced or mistaken receipts. The balance goes back up."
          confirmLabel="Reverse payment"
          onClose={() => setModal(null)}
          action={async (reason) => {
            update(await post<Invoice>(`/payments/${modal.reverse.id}/reverse`, { reason }));
            toast.success('Payment reversed.');
            setModal(null);
          }}
        />
      )}
    </>
  );
}
