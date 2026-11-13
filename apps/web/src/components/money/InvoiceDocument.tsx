import { amountInWords, gstinDetails, lineAmount, percentLabel } from '@know-crm/shared';
import { date, money } from '@/lib/format';
import type { BillingSettings, Invoice } from './types';
import { InvoiceStatusBadge } from './StatusBadge';

/**
 * The invoice as the client sees it. `#invoice-print` is the only element shown
 * when the page is printed (see the scoped print rule in the invoice page).
 */
export function InvoiceDocument({
  invoice,
  billing,
  workspaceName,
}: {
  invoice: Invoice;
  billing?: BillingSettings;
  workspaceName: string;
}) {
  const c = invoice.currency;
  const seller = invoice.seller_details.trim() || billing?.address || '';
  const sellerState = invoice.tax_id ? gstinDetails(invoice.tax_id)?.state : null;
  const buyerState = invoice.buyer_tax_id ? gstinDetails(invoice.buyer_tax_id)?.state : null;
  const taxes = invoice.tax_components?.length
    ? invoice.tax_components
    : invoice.tax_amount
      ? [{ label: invoice.tax_label, rate: invoice.tax_rate, amount: invoice.tax_amount }]
      : [];
  const hasBank = billing?.bankAccountNumber || billing?.bankName;

  return (
    <article
      id="invoice-print"
      className="card mx-auto max-w-4xl p-6 sm:p-10 print:border-0 print:p-0"
    >
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
        <div>
          <p className="text-lg font-semibold">{workspaceName}</p>
          {seller && <p className="mt-1 text-sm whitespace-pre-line text-mute">{seller}</p>}
          {invoice.tax_id && (
            <p className="mt-1 text-sm text-mute">
              GSTIN {invoice.tax_id}
              {sellerState && ` · ${sellerState}`}
            </p>
          )}
          {(billing?.email || billing?.phone) && (
            <p className="text-sm text-mute">
              {[billing?.email, billing?.phone].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight">{invoice.heading}</p>
          <p className="mt-1 text-sm text-mute">{invoice.number}</p>
          <div className="mt-2 print:hidden">
            <InvoiceStatusBadge status={invoice.status} />
          </div>
        </div>
      </header>

      <section className="grid gap-6 border-b border-line py-6 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-1">Billed to</p>
          <p className="font-medium">
            {invoice.billed_to?.company || invoice.billed_to?.name || invoice.client_name}
          </p>
          {invoice.billed_to?.company &&
            invoice.billed_to?.name &&
            invoice.billed_to.name !== invoice.billed_to.company && (
              <p className="text-sm text-mute">{invoice.billed_to.name}</p>
            )}
          {invoice.billed_to?.address && (
            <p className="text-sm whitespace-pre-line text-mute">{invoice.billed_to.address}</p>
          )}
          {invoice.billed_to?.email && (
            <p className="text-sm text-mute">{invoice.billed_to.email}</p>
          )}
          {invoice.buyer_tax_id && (
            <p className="text-sm text-mute">
              GSTIN {invoice.buyer_tax_id}
              {buyerState && ` · ${buyerState}`}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:text-right">
          <dt className="text-mute">Issued</dt>
          <dd>{invoice.issued_at ? date(invoice.issued_at) : 'Not issued'}</dd>
          <dt className="text-mute">Due</dt>
          <dd>{date(invoice.due_date)}</dd>
          {invoice.purchase_order && (
            <>
              <dt className="text-mute">PO</dt>
              <dd>{invoice.purchase_order}</dd>
            </>
          )}
          <dt className="text-mute">Project</dt>
          <dd>{invoice.project_name}</dd>
        </dl>
      </section>

      <section className="py-6">
        <p className="mb-1 font-medium">{invoice.title}</p>
        {invoice.introduction && (
          <p className="mb-4 text-sm whitespace-pre-line text-mute">{invoice.introduction}</p>
        )}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Service</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={i}>
                  <td className="text-mute">{i + 1}</td>
                  <td>
                    <p className="font-medium">{l.name}</p>
                    {l.description && (
                      <p className="text-xs whitespace-pre-line text-mute">{l.description}</p>
                    )}
                    {!l.taxable && taxes.length > 0 && (
                      <p className="text-xs text-faint">Not taxable</p>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {Number(l.quantity)} {l.unit !== 'unit' ? l.unit : ''}
                  </td>
                  <td className="text-right tabular-nums">{money(l.unit_price, c)}</td>
                  <td className="text-right tabular-nums">
                    {money(
                      lineAmount({ quantity: Number(l.quantity), unitPrice: l.unit_price }),
                      c,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 ml-auto max-w-sm space-y-1.5 text-sm">
          <Line label="Subtotal" value={money(invoice.subtotal, c)} />
          {invoice.discount_amount > 0 && (
            <Line
              label={`Discount${invoice.discount_type === 'percent' ? ` (${percentLabel(invoice.discount_value)})` : ''}`}
              value={`− ${money(invoice.discount_amount, c)}`}
            />
          )}
          {invoice.service_charge_amount > 0 && (
            <Line
              label={`${invoice.service_charge_label} (${percentLabel(invoice.service_charge_rate)})`}
              value={money(invoice.service_charge_amount, c)}
            />
          )}
          {taxes.map((t, i) => (
            <Line
              key={i}
              label={`${t.label} (${percentLabel(t.rate)})`}
              value={money(t.amount, c)}
            />
          ))}
          <div className="border-t border-line pt-1.5">
            <Line label={<b>Total</b>} value={<b>{money(invoice.total, c)}</b>} />
          </div>
          {invoice.paid > 0 && <Line label="Paid" value={`− ${money(invoice.paid, c)}`} />}
          {invoice.status !== 'void' && invoice.stored_status !== 'draft' && (
            <Line label={<b>Balance due</b>} value={<b>{money(invoice.balance, c)}</b>} />
          )}
          <p className="pt-1 text-xs text-faint">{amountInWords(invoice.total, c)}</p>
        </div>
      </section>

      {invoice.installments.length > 1 && (
        <section className="border-t border-line py-6">
          <p className="eyebrow mb-2">Payment schedule</p>
          <table className="table">
            <tbody>
              {invoice.installments.map((i) => (
                <tr key={i.id}>
                  <td>{i.label}</td>
                  <td className="text-mute">{date(i.due_date)}</td>
                  <td className="text-right tabular-nums">{money(i.amount, c)}</td>
                  <td className="text-right text-xs text-mute capitalize">{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(hasBank || billing?.terms) && (
        <footer className="grid gap-6 border-t border-line pt-6 text-sm sm:grid-cols-2">
          {hasBank && (
            <div>
              <p className="eyebrow mb-1">Bank details</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-mute">
                {billing?.bankAccountName && (
                  <>
                    <dt>Account name</dt>
                    <dd className="text-ink">{billing.bankAccountName}</dd>
                  </>
                )}
                {billing?.bankName && (
                  <>
                    <dt>Bank</dt>
                    <dd className="text-ink">{billing.bankName}</dd>
                  </>
                )}
                {billing?.bankAccountNumber && (
                  <>
                    <dt>Account no.</dt>
                    <dd className="text-ink">{billing.bankAccountNumber}</dd>
                  </>
                )}
                {billing?.bankIfsc && (
                  <>
                    <dt>IFSC</dt>
                    <dd className="text-ink">{billing.bankIfsc}</dd>
                  </>
                )}
                {billing?.bankAccountType && (
                  <>
                    <dt>Type</dt>
                    <dd className="text-ink">{billing.bankAccountType}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
          {billing?.terms && (
            <div>
              <p className="eyebrow mb-1">Terms</p>
              <p className="whitespace-pre-line text-mute">{billing.terms}</p>
            </div>
          )}
        </footer>
      )}
      {invoice.status === 'void' && (
        <p className="mt-6 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Voided {date(invoice.voided_at)}
          {invoice.void_reason ? `: ${invoice.void_reason}` : ''}
        </p>
      )}
    </article>
  );
}

function Line({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-mute">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
