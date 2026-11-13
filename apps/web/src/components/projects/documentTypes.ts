import type { DocKind } from './types';

export type Block =
  | { id: string; type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'service'; name: string; description: string; quantity: number; unitPrice: number; currency: string }
  | { id: string; type: 'question'; label: string; questionType: 'short' | 'long' | 'choice'; required: boolean; options: string[] }
  | { id: string; type: 'signature'; label: string };

export interface DocAction {
  id: string;
  user_id: string;
  actor_name: string;
  action: 'answered' | 'accepted' | 'declined' | 'signed';
  block_id: string | null;
  typed_name: string | null;
  answers: Record<string, string> | null;
  created_at: string;
}

export interface FullDocument {
  id: string;
  project_id: string;
  template_id: string | null;
  title: string;
  kind: DocKind;
  status: 'draft' | 'published';
  blocks: Block[];
  content_hash: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  actions: DocAction[];
  consentText: string;
}

export function serviceTotals(blocks: Block[]) {
  const totals: Record<string, number> = {};
  for (const b of blocks) if (b.type === 'service') totals[b.currency] = (totals[b.currency] ?? 0) + Math.round(b.quantity * b.unitPrice);
  return Object.entries(totals);
}
