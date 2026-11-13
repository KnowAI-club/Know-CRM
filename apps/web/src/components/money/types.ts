import type { Tone } from '@/components/ui';

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void';

export interface InvoiceLine {
  name: string;
  description: string;
  section: string;
  unit: string;
  quantity: number | string;
  unit_price: number;
  taxable: boolean;
}

export interface Installment {
  id: string;
  label: string;
  amount: number;
  due_date: string | null;
  paid: number;
  balance: number;
  status: 'paid' | 'overdue' | 'upcoming' | 'void';
}

export interface Payment {
  id: string;
  amount: number;
  method: string;
  reference: string;
  received_date: string;
  reversed: boolean;
  reversal_reason: string | null;
  recorded_by_name?: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  project_id: string;
  project_name: string;
  client_name: string;
  number: string;
  title: string;
  heading: string;
  introduction: string;
  purchase_order: string;
  tax_label: string;
  service_charge_label: string;
  tax_id: string;
  seller_details: string;
  buyer_tax_id: string;
  subtotal: number;
  discount_type: 'none' | 'fixed' | 'percent';
  discount_value: number;
  discount_amount: number;
  service_charge_rate: number;
  service_charge_amount: number;
  tax_rate: number;
  tax_amount: number;
  tax_components: { label: string; rate: number; amount: number }[] | null;
  total: number;
  currency: string;
  due_date: string | null;
  status: InvoiceStatus;
  stored_status: 'draft' | 'sent' | 'void';
  issued_at: string | null;
  billed_to: { name?: string; email?: string; company?: string; address?: string } | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  lines: InvoiceLine[];
  installments: Installment[];
  payments: Payment[];
  paid: number;
  balance: number;
  next_payment_due: string | null;
}

export interface RecurringSchedule {
  id: string;
  project_id: string;
  source_invoice_id: string;
  interval: 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  next_date: string;
  end_date: string | null;
  due_days: number;
  max_occurrences: number;
  generated: number;
  state: 'active' | 'paused' | 'cancelled' | 'completed';
  source_number: string;
  source_title: string;
  project_name: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  unit_price: number;
  unit: string;
  currency: string;
  archived: boolean;
}

export interface BillingSettings {
  address?: string;
  gstin?: string;
  email?: string;
  phone?: string;
  bankAccountName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankAccountType?: string;
  terms?: string;
}

export interface WorkspaceSettings {
  name: string;
  currency: string;
  timezone: string;
  data: {
    billing?: BillingSettings;
    defaultLeadOwnerId?: string;
  };
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partial: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

export const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warn',
  paid: 'ok',
  overdue: 'danger',
  void: 'neutral',
};

export const INSTALLMENT_TONE: Record<Installment['status'], Tone> = {
  paid: 'ok',
  overdue: 'danger',
  upcoming: 'neutral',
  void: 'neutral',
};
