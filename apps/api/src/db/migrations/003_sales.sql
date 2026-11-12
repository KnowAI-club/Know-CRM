-- Leads / sales pipeline.

CREATE TABLE lead_stages (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  color text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  position integer NOT NULL CHECK (position >= 0),
  system boolean NOT NULL DEFAULT false,
  -- 'won' stages hand the lead off to a project stage.
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won')),
  project_stage_id text REFERENCES project_stages(id),
  CONSTRAINT lead_stages_position_key UNIQUE (position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT lead_stages_handoff CHECK (
    (kind = 'won' AND project_stage_id IS NOT NULL) OR (kind = 'open' AND project_stage_id IS NULL))
);
CREATE UNIQUE INDEX lead_stages_label ON lead_stages (lower(label));
INSERT INTO lead_stages (id, label, color, position, system, kind, project_stage_id) VALUES
  ('new', 'New', '#b7aa97', 0, true, 'open', NULL),
  ('discovery', 'Discovery', '#9ca7cf', 1, true, 'open', NULL),
  ('qualified', 'Qualified', '#9584b6', 2, true, 'open', NULL),
  ('proposal', 'Proposal shared', '#d2ac67', 3, false, 'open', NULL),
  ('won', 'Closed won', '#6b8e78', 4, true, 'won', 'inquiry');

-- Shared picklists for leads.
CREATE TABLE lead_options (
  kind text NOT NULL CHECK (kind IN ('source', 'industry')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 300),
  PRIMARY KEY (kind, label)
);
CREATE UNIQUE INDEX lead_options_label ON lead_options (kind, lower(label));
INSERT INTO lead_options (kind, label) VALUES
  ('source', 'Website'), ('source', 'Referral'), ('source', 'Word of mouth'), ('source', 'LinkedIn'),
  ('source', 'Instagram'), ('source', 'X'), ('source', 'Client alumni'), ('source', 'Lead form'), ('source', 'Booking'),
  ('industry', 'Technology'), ('industry', 'Retail'), ('industry', 'Healthcare'), ('industry', 'Education'),
  ('industry', 'Finance'), ('industry', 'Manufacturing'), ('industry', 'Real estate');

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  email text NOT NULL CHECK (length(email) <= 254),
  -- active: in pipeline · nurture: parked · won: handed off · dropped: archived
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'nurture', 'won', 'dropped')),
  stage text NOT NULL REFERENCES lead_stages(id) ON UPDATE CASCADE,
  -- Profile fields (company, phone, funnel, temperature, source, industry, owner_id, problem, goals...).
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  project_id uuid UNIQUE REFERENCES projects(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  exit_status text NOT NULL DEFAULT '' CHECK (exit_status IN ('', 'no_show', 'on_hold', 'closed_lost', 'disqualified')),
  exit_reason text NOT NULL DEFAULT '',
  resume_date date,
  exited_at timestamptz,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX leads_open_email ON leads (lower(email)) WHERE state IN ('active', 'nurture');
CREATE INDEX leads_email ON leads (lower(email));
CREATE INDEX leads_state ON leads (state, created_at DESC);

-- One row per lead parked in Nurtures or archived.
CREATE TABLE lead_nurture (
  lead_id uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  entry_stage text NOT NULL REFERENCES lead_stages(id) ON UPDATE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'parked' CHECK (status IN ('parked', 'archived')),
  tags text[] NOT NULL DEFAULT '{}' CHECK (tags <@ ARRAY['follow_up', 'not_ready', 'client_alumni', 'archived']),
  owner_id uuid REFERENCES users(id),
  revisit_date date,
  confirmation_due_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES users(id),
  archived_at timestamptz,
  archive_reason text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'pipeline' CHECK (source IN ('pipeline', 'inbound', 'imported', 'replied')),
  discarded_at timestamptz,
  discard_reason text NOT NULL DEFAULT '',
  entered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_won (
  lead_id uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  won_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_history_lead ON lead_history (lead_id, created_at);

CREATE TABLE lead_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_comments_lead ON lead_comments (lead_id, created_at);

CREATE TABLE lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_notes_lead ON lead_notes (lead_id, created_at DESC);

CREATE TABLE lead_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  name text NOT NULL,
  size bigint NOT NULL CHECK (size >= 0),
  mime text NOT NULL DEFAULT 'application/octet-stream',
  to_share boolean NOT NULL DEFAULT false,
  file_type_id uuid REFERENCES file_types(id),
  storage_key text NOT NULL UNIQUE,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_attachments_lead ON lead_attachments (lead_id);

-- Tasks belong to exactly one project or lead.
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  due_date date,
  assignee_id uuid REFERENCES users(id),
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'client')),
  completed boolean NOT NULL DEFAULT false,
  urgent boolean NOT NULL DEFAULT false,
  kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'record_outcome', 'nurture_followup', 'revisit')),
  source_id text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT tasks_one_target CHECK (num_nonnulls(project_id, lead_id) = 1)
);
CREATE UNIQUE INDEX tasks_source ON tasks (kind, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX tasks_project ON tasks (project_id);
CREATE INDEX tasks_lead ON tasks (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX tasks_assignee_open ON tasks (assignee_id, due_date) WHERE NOT completed;

-- Email library (draft copy the team sends by hand).
CREATE TABLE email_templates (
  id text PRIMARY KEY CHECK (id ~ '^[A-Z]{2}-\d{2,}$'),
  grp text NOT NULL CHECK (grp IN ('EM', 'NU')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO email_templates (id, grp, title, subject, body) VALUES
  ('EM-01', 'EM', 'Booking confirmation', 'Your call is confirmed', E'Hi {{first_name}},\n\nThanks for booking a call with us. We are looking forward to speaking on {{meeting_date}}.\n\nBest,\n{{owner_name}}'),
  ('EM-02', 'EM', 'Call thank-you', 'Thanks for your time today', E'Hi {{first_name}},\n\nThank you for the conversation today. As discussed, the next step is: {{next_step}}.\n\nBest,\n{{owner_name}}'),
  ('EM-03', 'EM', 'No-show reschedule', 'Shall we find another time?', E'Hi {{first_name}},\n\nWe missed you on the call. Would you like to pick another time?\n\n{{booking_link}}\n\nBest,\n{{owner_name}}'),
  ('EM-04', 'EM', 'Billing details request', 'Billing details for your project', E'Hi {{first_name}},\n\nTo prepare your invoice, could you share your legal business name, billing address and GSTIN?\n\nThanks,\n{{owner_name}}'),
  ('EM-05', 'EM', 'Proposal follow-up', 'Following up on the proposal', E'Hi {{first_name}},\n\nJust checking in on the proposal for {{company}}. Happy to answer any questions.\n\nBest,\n{{owner_name}}'),
  ('EM-06', 'EM', 'Payment confirmation', 'Payment received, thank you', E'Hi {{first_name}},\n\nWe have received your payment. Thank you!\n\nBest,\n{{owner_name}}'),
  ('NU-01', 'NU', 'Checking back in', 'Checking back in', E'Hi {{first_name}},\n\nIt has been a while since we last spoke about {{problem}}. Is this still on your list?\n\nBest,\n{{owner_name}}');
