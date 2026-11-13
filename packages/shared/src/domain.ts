export const ROLES = ['admin', 'sales', 'designer', 'developer', 'client'] as const;
export type Role = (typeof ROLES)[number];
export const TEAM_ROLES = ['admin', 'sales', 'designer', 'developer'] as const;
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Workspace admin',
  sales: 'Business team',
  designer: 'Designer',
  developer: 'Developer',
  client: 'Client',
};

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const;

export const LEAD_STATES = ['active', 'won', 'dropped'] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const EXIT_STATUSES = ['no_show', 'on_hold', 'closed_lost', 'disqualified'] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];
export const EXIT_LABELS: Record<ExitStatus, string> = {
  no_show: 'No-show',
  on_hold: 'On hold',
  closed_lost: 'Closed lost',
  disqualified: 'Disqualified',
};
export const EXIT_HELP: Record<ExitStatus, string> = {
  no_show: 'Missed the call and did not reply to follow-ups.',
  on_hold: 'The client asked to pause; record a resume date.',
  closed_lost: 'Chose another option, budget, timing, or no longer a priority.',
  disqualified: 'Spam, a test, or no fit.',
};

export const PROJECT_CATEGORIES = ['inquiry', 'in_progress', 'completed', 'archived'] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const MILESTONE_STATUS_LABELS = {
  upcoming: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
} as const;

export const MEETING_OUTCOMES = ['attended', 'no_show', 'rescheduled', 'cancelled'] as const;
export const MEETING_OUTCOME_LABELS: Record<string, string> = {
  attended: 'Attended',
  no_show: 'No-show',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
};

export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other'] as const;
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
};

export const EXPENSE_CATEGORIES: Record<string, string> = {
  advertising: 'Advertising & marketing',
  contract_labor: 'Contract labor',
  equipment: 'Equipment',
  insurance: 'Insurance',
  meals: 'Meals',
  office: 'Office expenses',
  professional_services: 'Legal & professional services',
  rent: 'Rent or lease',
  software: 'Software & subscriptions',
  supplies: 'Supplies',
  travel: 'Travel',
  utilities: 'Utilities',
  other: 'Other',
};

export const NOTIFICATION_KINDS: Record<string, string> = {
  mention: 'Someone @mentions you',
  task_assigned: 'A task is assigned to you',
  reminder: 'A reminder is due',
  booking: 'Bookings, reschedules and cancellations',
  lead_form: 'A lead form is submitted',
  client_activity: 'A client acts on your project',
};

/** Replaces {{field}} tokens; unknown tokens are left as-is (or shown via `missing`). */
export function fillMerge(text: string, values: Record<string, string | undefined>, missing?: (k: string) => string) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    const v = values[key];
    return v ? v : missing ? missing(key) : m;
  });
}

export const MERGE_FIELDS = [
  'first_name',
  'company',
  'industry',
  'problem',
  'owner_name',
  'client_name',
  'client_email',
  'meeting_date',
  'next_step',
  'booking_link',
  'project_name',
] as const;
