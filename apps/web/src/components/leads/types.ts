import { ApiError } from '@/lib/api';

export type LeadState = 'active' | 'won' | 'dropped';

/** Profile fields stored in leads.data (all optional on older rows). */
export interface LeadData {
  funnel: 'inbound' | 'outbound';
  temperature: 'warm' | 'cold';
  company: string;
  phone: string;
  website: string;
  socials: string;
  budget: string;
  timeline: string;
  industry: string;
  source: string;
  ownerId: string;
  problem: string;
  goals: string;
  description: string;
  wants: string;
  notes: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  qualifiedFit: 'unknown' | 'yes' | 'no';
  attendance: 'unknown' | 'yes' | 'no';
  outcome: 'none' | 'ideal' | 'no_show' | 'ghost' | 'refused';
  billingName: string;
  billingEmail: string;
  billingAddress: string;
  taxId: string;
}

export const EMPTY_DATA: LeadData = {
  funnel: 'inbound',
  temperature: 'warm',
  company: '',
  phone: '',
  website: '',
  socials: '',
  budget: '',
  timeline: '',
  industry: '',
  source: '',
  ownerId: '',
  problem: '',
  goals: '',
  description: '',
  wants: '',
  notes: '',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  qualifiedFit: 'unknown',
  attendance: 'unknown',
  outcome: 'none',
  billingName: '',
  billingEmail: '',
  billingAddress: '',
  taxId: '',
};

export interface Lead {
  id: string;
  name: string;
  email: string;
  state: LeadState;
  stage: string;
  data: Partial<LeadData>;
  version: number;
  project_id: string | null;
  contact_id: string | null;
  exit_status: string;
  exit_reason: string;
  resume_date: string | null;
  exited_at: string | null;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  owner_name: string | null;
  project_name: string | null;
  project_archived: boolean | null;
}

export interface Stage {
  id: string;
  label: string;
  color: string;
  position: number;
  system: boolean;
  kind: 'open' | 'won';
  project_stage_id: string | null;
  lead_count: number;
}

export interface LeadOption {
  kind: 'source' | 'industry';
  label: string;
  lead_count: number;
}

export const withDefaults = (data: Partial<LeadData> | null | undefined): LeadData => ({ ...EMPTY_DATA, ...(data ?? {}) });

export const STATE_LABELS: Record<LeadState, string> = {
  active: 'In pipeline',
  dropped: 'Archived',
  won: 'Closed won',
};

export const STATE_TONES = { active: 'acc', dropped: 'neutral', won: 'ok' } as const;

/** Field-level messages from an API validation error. */
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? (e.details?.fields ?? {}) : {};
}

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;
