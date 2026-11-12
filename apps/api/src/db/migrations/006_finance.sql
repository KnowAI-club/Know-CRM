-- Invoices (GST-ready), instalments, manual receipts, recurring drafts, expenses and services.

CREATE SEQUENCE invoice_number_seq;

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  number text NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  heading text NOT NULL DEFAULT 'Invoice',
  introduction text NOT NULL DEFAULT '',
  purchase_order text NOT NULL DEFAULT '',
  tax_label text NOT NULL DEFAULT 'Tax',
  service_charge_label text NOT NULL DEFAULT 'Service charge',
  tax_id text NOT NULL DEFAULT '',
  seller_details text NOT NULL DEFAULT '',
  buyer_tax_id text NOT NULL DEFAULT '',
  subtotal bigint NOT NULL,
  discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'fixed', 'percent')),
  discount_value bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  service_charge_rate integer NOT NULL DEFAULT 0 CHECK (service_charge_rate BETWEEN 0 AND 10000),
  service_charge_amount bigint NOT NULL DEFAULT 0,
  tax_rate integer NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 10000),
  tax_amount bigint NOT NULL DEFAULT 0,
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  total bigint NOT NULL CHECK (total > 0 AND total <= 100000000000),
  currency char(3) NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'void')),
  issued_at timestamptz,
  billed_to jsonb,
  voided_at timestamptz,
  voided_by uuid REFERENCES users(id),
  void_reason text,
  idempotency_key text UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_project ON invoices (project_id);

CREATE TABLE invoice_lines (
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  section text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'unit',
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  unit_price bigint NOT NULL CHECK (unit_price BETWEEN 0 AND 100000000000),
  taxable boolean NOT NULL DEFAULT false,
  PRIMARY KEY (invoice_id, position)
);

CREATE TABLE invoice_installments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  amount bigint NOT NULL CHECK (amount > 0),
  due_date date,
  PRIMARY KEY (invoice_id, id),
  UNIQUE (invoice_id, position)
);

-- Receipts ledger: rows are reversed, never deleted.
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other')),
  reference text NOT NULL DEFAULT '',
  received_date date NOT NULL,
  reversed boolean NOT NULL DEFAULT false,
  reversal_reason text,
  idempotency_key text UNIQUE,
  recorded_by uuid REFERENCES users(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice ON payments (invoice_id);

CREATE TABLE recurring_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_invoice_id uuid NOT NULL REFERENCES invoices(id),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  template jsonb NOT NULL,
  interval text NOT NULL CHECK (interval IN ('weekly', 'monthly', 'yearly')),
  start_date date NOT NULL,
  next_date date NOT NULL,
  end_date date,
  due_days integer NOT NULL DEFAULT 14 CHECK (due_days BETWEEN 0 AND 90),
  max_occurrences integer NOT NULL DEFAULT 12 CHECK (max_occurrences BETWEEN 1 AND 120),
  generated integer NOT NULL DEFAULT 0 CHECK (generated >= 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX recurring_invoices_due ON recurring_invoices (state, next_date);

CREATE TABLE recurring_invoice_runs (
  schedule_id uuid NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
  period_date date NOT NULL,
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, period_date)
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spent_on date NOT NULL,
  vendor text NOT NULL CHECK (length(vendor) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 100000000000),
  currency char(3) NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_spent ON expenses (spent_on DESC);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  unit_price bigint NOT NULL CHECK (unit_price BETWEEN 0 AND 100000000000),
  currency char(3) NOT NULL,
  unit text NOT NULL DEFAULT 'project',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
