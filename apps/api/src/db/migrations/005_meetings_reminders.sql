-- Meetings, public booking pages and scheduled reminders.

CREATE TABLE booking_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  host_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  duration integer NOT NULL CHECK (duration BETWEEN 15 AND 480),
  buffer_before integer NOT NULL DEFAULT 0 CHECK (buffer_before BETWEEN 0 AND 240),
  buffer_after integer NOT NULL DEFAULT 0 CHECK (buffer_after BETWEEN 0 AND 240),
  minimum_notice integer NOT NULL DEFAULT 60,
  horizon integer NOT NULL DEFAULT 60,
  availability jsonb NOT NULL DEFAULT '[]'::jsonb,
  location text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type_id uuid NOT NULL REFERENCES booking_types(id),
  host_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  email text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  blocked_start timestamptz NOT NULL,
  blocked_end timestamptz NOT NULL,
  management_hash text NOT NULL UNIQUE,
  request_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_reservations_busy ON booking_reservations (host_id, blocked_start, blocked_end) WHERE status = 'confirmed';

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES users(id),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  booking_reservation_id uuid UNIQUE REFERENCES booking_reservations(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'phone', 'in_person')),
  start_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  sharing text NOT NULL DEFAULT 'internal' CHECK (sharing IN ('internal', 'client')),
  location text NOT NULL DEFAULT '',
  meeting_url text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'booking', 'upload')),
  outcome text CHECK (outcome IN ('attended', 'no_show', 'rescheduled', 'cancelled')),
  outcome_reason text NOT NULL DEFAULT '',
  outcome_at timestamptz,
  outcome_by uuid REFERENCES users(id),
  summary text NOT NULL DEFAULT '',
  decisions text NOT NULL DEFAULT '',
  transcript text NOT NULL DEFAULT '',
  -- [{channel:'in_app'|'email', minutes}]
  notifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetings_target CHECK (num_nonnulls(project_id, lead_id) >= 1)
);
CREATE INDEX meetings_start ON meetings (start_at);
CREATE INDEX meetings_lead ON meetings (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX meetings_project ON meetings (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE meeting_participants (
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  email text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, email)
);

CREATE TABLE meeting_next_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  owner_id uuid REFERENCES users(id),
  due_date date,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE meeting_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  name text NOT NULL,
  size bigint NOT NULL,
  mime text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reminder_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reminder_types_label ON reminder_types (lower(label));
INSERT INTO reminder_types (label, position) VALUES ('Follow up', 0), ('Send document', 1), ('Call back', 2);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  type_id uuid REFERENCES reminder_types(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email')),
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  auto_notice boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminders_one_target CHECK (num_nonnulls(project_id, lead_id, meeting_id) = 1)
);
CREATE INDEX reminders_due ON reminders (status, run_at);
CREATE INDEX reminders_meeting ON reminders (meeting_id) WHERE meeting_id IS NOT NULL;
