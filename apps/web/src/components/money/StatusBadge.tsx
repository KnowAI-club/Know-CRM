import { Badge } from '@/components/ui';
import { STATUS_LABEL, STATUS_TONE, type InvoiceStatus } from './types';

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
