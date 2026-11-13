export type FormFieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'date';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
}

export const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
];

export interface LeadForm {
  id: string;
  title: string;
  description: string;
  fields: FormField[];
  token: string;
  revision: number;
  published_version: number | null;
  archived: boolean;
  has_unpublished_changes: boolean;
  submission_count: number;
  created_at: string;
  updated_at: string;
}
