import { post } from '@/lib/api';
import type { Tracked } from './types';

export const markEmail = (assignmentId: string, emailId: string, body: { sent?: boolean; replied?: boolean }) =>
  post<Tracked>(`/nurtures/assignments/${assignmentId}/emails/${emailId}`, body);

export const assignmentOp = (assignmentId: string, op: 'pause' | 'resume' | 'remove') =>
  post(`/nurtures/assignments/${assignmentId}/${op}`);

/** The most recent sent email that has no reply yet (where a reply would be recorded). */
export function replyTarget(t: Tracked) {
  return [...t.plan].reverse().find((c) => c.sent_at && !c.replied_at) ?? null;
}

export function nextLabel(t: Tracked) {
  const n = t.next;
  if (n.kind === 'reply') return 'Replied — follow up personally';
  if (n.kind === 'paused') return 'Paused';
  if (n.kind === 'decide') return 'All emails sent — decide next step';
  const cell = t.plan.find((c) => c.email_id === n.emailId);
  const when = new Date(n.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return n.kind === 'send' ? `Email ${(cell?.position ?? 0) + 1} due since ${when}` : `Email ${(cell?.position ?? 0) + 1} on ${when}`;
}
