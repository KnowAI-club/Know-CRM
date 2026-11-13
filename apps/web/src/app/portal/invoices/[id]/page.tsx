'use client';
import { useParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorBox, PageHeader, Skeleton } from '@/components/ui';
import { InvoiceDocument } from '@/components/portal/InvoiceDocument';
import type { InvoiceView } from '@/components/projects/types';

export default function PortalInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useLoad((s) => get<InvoiceView & { project_id: string }>(`/invoices/${id}`, s), [id]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading || !data) return <Skeleton className="h-[32rem] w-full" />;
  return (
    <div>
      <div className="no-print">
        <PageHeader
          back={{ href: `/portal/projects/${data.project_id}?tab=invoices`, label: 'Invoices' }}
          title={data.number}
          actions={
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print or save PDF
            </Button>
          }
        />
      </div>
      <InvoiceDocument invoice={data} />
    </div>
  );
}
