export type CellStatus = 'replied' | 'sent' | 'paused' | 'due' | 'scheduled' | 'upcoming';

export interface PlanCell {
  email_id: string;
  position: number;
  day: number;
  subject: string;
  due_at: string;
  sent_at: string | null;
  replied_at: string | null;
  status: CellStatus;
}

export type NextAction =
  | { kind: 'reply'; group: 'replied' }
  | { kind: 'send' | 'wait'; at: string; emailId: string; group: 'active' }
  | { kind: 'paused'; group: 'paused' }
  | { kind: 'decide'; group: 'completed' };

export interface Tracked {
  id: string;
  lead_id: string;
  sequence_id: string;
  sequence_name: string;
  status: string;
  started_at: string;
  paused_at: string | null;
  name: string;
  email: string;
  company: string | null;
  discarded_at: string | null;
  discard_reason: string;
  source: string | null;
  plan: PlanCell[];
  next: NextAction;
  step: number;
  total: number;
  last_email_at: string;
}

export interface SeqEmail {
  id: string;
  position: number;
  day: number;
  send_time: string;
  sender: 'owner' | 'team' | 'person';
  sender_name: string;
  subject: string;
  preview: string;
  body: string;
  signature: string;
  note: string;
}

export interface SequenceStats {
  leads: number;
  sent: number;
  replied: number;
  due: number;
  replyRate: number;
  emails: number;
  perEmail: Record<string, { sent: number; replied: number; due: number }>;
}

export interface Sequence {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'draft';
  stop_on_reply: boolean;
  weekly_cap: boolean;
  emails: SeqEmail[];
  last_day?: number;
  stats: SequenceStats;
}

export interface SequenceSummary {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'draft';
  email_count?: number;
}

export interface GeneralLead {
  id: string;
  name: string;
  email: string;
  company: string | null;
  industry: string | null;
  source: string | null;
  reason: string;
  tags: string[];
  entered_at: string;
  revisit_date: string | null;
  owner_name: string | null;
}

export const SOURCE_LABELS: Record<string, string> = {
  pipeline: 'From pipeline',
  imported: 'Imported',
  inbound: 'Added here',
  replied: 'Replied',
};
