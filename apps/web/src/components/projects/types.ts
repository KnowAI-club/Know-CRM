export type Visibility = 'internal' | 'client';
export type StageCategory = 'inquiry' | 'in_progress' | 'completed' | 'archived';

export interface ProjectStage {
  id: string;
  label: string;
  color: string;
  category: StageCategory;
  position: number;
  project_count?: number;
}

export interface Project {
  id: string;
  name: string;
  contact_id: string;
  stage: string;
  stage_label: string;
  stage_color: string;
  stage_category: StageCategory;
  value: number;
  currency: string;
  description: string;
  due_date: string | null;
  start_date: string | null;
  owner_id: string;
  owner_name: string;
  progress: number;
  project_type: string;
  lead_source: string;
  archive_reason: string;
  contact_name: string;
  company: string;
  source_lead_id: string | null;
  unread?: boolean;
  created_at: string;
  updated_at: string;
}

export type MilestoneStatus = 'upcoming' | 'in_progress' | 'done';
export interface Milestone {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  due_date: string | null;
  position: number;
}

export interface Task {
  id: string;
  title: string;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  visibility: Visibility;
  completed: boolean;
  urgent: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  body: string;
  visibility: Visibility;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  visibility: Visibility;
  to_share?: boolean;
  file_type_id: string | null;
  file_type_label: string | null;
  created_at: string;
}

export interface MeetingRow {
  id: string;
  title: string;
  kind: string;
  start_at: string;
  duration_minutes: number;
  status: string;
  location: string | null;
  meeting_url: string | null;
  sharing: string;
  outcome: string | null;
}

export type DocKind = 'proposal' | 'contract' | 'questionnaire';
export interface DocumentRow {
  id: string;
  project_id?: string;
  title: string;
  kind: DocKind;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string;
  contact_name?: string;
  action_count?: number;
  last_action?: string | null;
}

export interface Message {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  author_id: string;
  created_at: string;
}

export interface Installment {
  id: string;
  label: string;
  amount: number;
  due_date: string | null;
  paid: number;
  balance: number;
  status: string;
}
export interface InvoiceView {
  id: string;
  number: string;
  title: string;
  heading: string;
  introduction: string;
  status: string;
  currency: string;
  subtotal: number;
  discount_amount: number;
  service_charge_label: string;
  service_charge_amount: number;
  tax_label: string;
  tax_amount: number;
  tax_components: { label: string; rate: number; amount: number }[];
  total: number;
  paid: number;
  balance: number;
  due_date: string | null;
  issued_at: string | null;
  next_payment_due: string | null;
  billed_to: { name?: string; email?: string; address?: string; company?: string };
  seller_details: string;
  tax_id: string;
  buyer_tax_id: string;
  lines: { position: number; name: string; description: string; section: string; unit: string; quantity: number; unit_price: number }[];
  installments: Installment[];
  payments: { id: string; amount: number; method: string; reference: string; received_date: string; reversed: boolean }[];
}

export interface Activity {
  id: string;
  description: string;
  actor_name: string;
  visibility?: Visibility;
  created_at: string;
}

export interface Participant {
  id: string;
  name: string;
  email: string;
}

export interface ProjectDetail {
  project: Project;
  tasks: Task[];
  notes: Note[];
  files: ProjectFile[];
  milestones: Milestone[];
  meetings: MeetingRow[];
  documents: DocumentRow[];
  messages: Message[];
  invoices: InvoiceView[];
  activity: Activity[];
  participants: Participant[];
  clientInfo: { contact: Record<string, any> | null; lead: Record<string, any> | null };
}

export interface FileType {
  id: string;
  label: string;
}
