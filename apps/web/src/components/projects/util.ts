import { ApiError } from '@/lib/api';
import type { Tone } from '@/components/ui';

/** Field-level messages from a 400 validation error, keyed by request field. */
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? (e.details?.fields ?? {}) : {};
}

export const STAGE_TONE: Record<string, Tone> = {
  inquiry: 'warn',
  in_progress: 'acc',
  completed: 'ok',
  archived: 'neutral',
};

export const MILESTONE_LABEL = { upcoming: 'Upcoming', in_progress: 'In progress', done: 'Done' } as const;
export const MILESTONE_TONE: Record<string, Tone> = { upcoming: 'neutral', in_progress: 'info', done: 'ok' };

export const DOC_KIND_LABEL = { proposal: 'Proposal', contract: 'Contract', questionnaire: 'Questionnaire' } as const;

export const INVOICE_TONE: Record<string, Tone> = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warn',
  paid: 'ok',
  overdue: 'danger',
  void: 'neutral',
};

export function minutesLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** Client-side random id for document blocks. */
export function blockId() {
  return `b_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
