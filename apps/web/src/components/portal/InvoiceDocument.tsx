'use client';
import { useSession } from '@/lib/session';
import { date, money, titleCase } from '@/lib/format';
import { Badge } from '@/components/ui';
import type { InvoiceView } from '@/components/projects/types';
import { INVOICE_TONE } from '@/components/projects/util';

/** Full, printable invoice as the client sees it. */
export function InvoiceDocument({ invoice: i }: { invoice: InvoiceView }) {
  const { workspace } = useSession();
  const billing = (workspace?.data?.billing ?? {}) as Record<string, string>;
  const c = i.currency;
  return (
    <article className="card p-6 sm:p-10 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start gap-6 border-b border-line pb-6">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{workspace?.name}</p>
          {i.seller_details ? (
            <p className="mt-1 text-xs whitespace-pre-wrap text-mute">{i.seller_details}</p>
          ) : (
            <div className="mt-1 text-xs text-mute">
              {billing.address && <p className="whitespace-pre-wrap">{billing.address}</p>}
              {billing.email && <p>{billing.email}</p>}
            </div>
          )}
          {(i.tax_id || billing.gstin) && <p className="mt-1 text-xs text-mute">GSTIN {i.tax_id || billing.gstin}</p>}
        </div>
        <div className="text-right">
          <p className="eyebrow">{i.heading || 'Invoice'}</p>
          <p className="text-xl font-semibold tabular-nums">{i.number}</p>
          <Badge tone={INVOICE_TONE[i.status] ?? 'neutral'} className="mt-1">
            {titleCase(i.status)}
          </Badge>
        </div>
      </header>
      <div className="grid gap-6 border-b border-line py-6 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-1">Billed to</p>
          <p className="text-sm font-medium">{i.billed_to?.name}</p>
          {i.billed_to?.company && <p className="text-sm text-mute">{i.billed_to.company}</p>}
          {i.billed_to?.address && <p className="text-xs whitespace-pre-wrap text-mute">{i.billed_to.address}</p>}
          {i.billed_to?.email && <p className="text-xs text-mute">{i.billed_to.email}</p>}
          {i.buyer_tax_id && <p className="text-xs text-mute">GSTIN {i.buyer_tax_id}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:text-right">
          <dt className="text-mute">Issued</dt>
          <dd>{date(i.issued_at)}</dd>
          <dt className="text-mute">Due</dt>
          <dd>{date(i.due_date)}</dd>
          {i.next_payment_due && i.balance > 0 && (
            <>
              <dt className="text-mute">Next payment</dt>
              <dd>{date(i.next_payment_due)}</dd>
            </>
          )}
        </dl>
      </div>
      {i.title && <p className="pt-6 text-sm font-medium">{i.title}</p>}
      {i.introduction && <p className="mt-1 text-sm whitespace-pre-wrap text-mute">{i.introduction}</p>}
      <div className="overflow-x-auto py-4">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l, idx) => {
              const head = l.section && l.section !== i.lines[idx - 1]?.section ? l.section : null;
              return [
                head && (
                  <tr key={`s-${l.position}`}>
                    <td colSpan={4} className="eyebrow pt-4">
                      {head}
                    </td>
                  </tr>
                ),
                <tr key={l.position}>
                  <td>
                    <p className="font-medium">{l.name}</p>
                    {l.description && <p className="text-xs whitespace-pre-wrap text-mute">{l.description}</p>}
                  </td>
                  <td className="text-right tabular-nums">
                    {l.quantity} {l.unit !== 'unit' ? l.unit : ''}
                  </td>
                  <td className="text-right tabular-nums">{money(l.unit_price, c)}</td>
                  <td className="text-right tabular-nums">{money(Math.round(l.quantity * l.unit_price), c)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-mute">Subtotal</dt>
          <dd className="tabular-nums">{money(i.subtotal, c)}</dd>
        </div>
        {i.discount_amount > 0 && (
          <div className="flex justify-between">
            <dt className="text-mute">Discount</dt>
            <dd className="tabular-nums">−{money(i.discount_amount, c)}</dd>
          </div>
        )}
        {i.service_charge_amount > 0 && (
          <div className="flex justify-between">
            <dt className="text-mute">{i.service_charge_label}</dt>
            <dd className="tabular-nums">{money(i.service_charge_amount, c)}</dd>
          </div>
        )}
        {i.tax_components?.length
          ? i.tax_components.map((t) => (
              <div key={t.label} className="flex justify-between">
                <dt className="text-mute">
                  {t.label} ({t.rate / 100}%)
                </dt>
                <dd className="tabular-nums">{money(t.amount, c)}</dd>
              </div>
            ))
          : i.tax_amount > 0 && (
              <div className="flex justify-between">
                <dt className="text-mute">{i.tax_label}</dt>
                <dd className="tabular-nums">{money(i.tax_amount, c)}</dd>
              </div>
            )}
        <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(i.total, c)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mute">Paid</dt>
          <dd className="tabular-nums">{money(i.paid, c)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>Balance due</dt>
          <dd className="tabular-nums">{money(i.balance, c)}</dd>
        </div>
      </dl>
      {i.installments.length > 0 && (
        <section className="mt-8">
          <p className="eyebrow mb-2">Payment schedule</p>
          <table className="table">
            <thead>
              <tr>
                <th>Instalment</th>
                <th>Due</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {i.installments.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td className="text-mute">{date(s.due_date)}</td>
                  <td className="text-right tabular-nums">{money(s.amount, c)}</td>
                  <td className="text-right tabular-nums">{money(s.balance, c)}</td>
                  <td>
                    <Badge
                      tone={s.status === 'paid' ? 'ok' : s.status === 'overdue' ? 'danger' : s.status === 'partial' ? 'warn' : 'neutral'}
                    >
                      {titleCase(s.status)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {i.payments.filter((p) => !p.reversed).length > 0 && (
        <section className="mt-8">
          <p className="eyebrow mb-2">Payments received</p>
          <ul className="divide-y divide-line text-sm">
            {i.payments
              .filter((p) => !p.reversed)
              .map((p) => (
                <li key={p.id} className="flex gap-3 py-2">
                  <span className="text-mute">{date(p.received_date)}</span>
                  <span>{titleCase(p.method)}</span>
                  {p.reference && <span className="text-faint">{p.reference}</span>}
                  <span className="ml-auto tabular-nums">{money(p.amount, c)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
      {(billing.bankAccountNumber || billing.terms) && i.balance > 0 && (
        <footer className="mt-8 grid gap-4 border-t border-line pt-6 text-xs text-mute sm:grid-cols-2">
          {billing.bankAccountNumber && (
            <div>
              <p className="eyebrow mb-1">Pay by bank transfer</p>
              {billing.bankAccountName && <p>{billing.bankAccountName}</p>}
              {billing.bankName && <p>{billing.bankName}</p>}
              <p>Account {billing.bankAccountNumber}</p>
              {billing.bankIfsc && <p>IFSC {billing.bankIfsc}</p>}
            </div>
          )}
          {billing.terms && (
            <div>
              <p className="eyebrow mb-1">Terms</p>
              <p className="whitespace-pre-wrap">{billing.terms}</p>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
