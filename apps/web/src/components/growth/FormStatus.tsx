import { Badge } from '@/components/ui';
import type { LeadForm } from './types';

export function FormStatus({ form: f }: { form: LeadForm }) {
  if (f.archived) return <Badge>Archived</Badge>;
  if (!f.published_version) return <Badge tone="warn">Draft</Badge>;
  if (f.has_unpublished_changes) return <Badge tone="info">Unpublished changes</Badge>;
  return <Badge tone="ok">Live</Badge>;
}
