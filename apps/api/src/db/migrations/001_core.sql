-- Core: workspace settings, people, sessions, audit trail and notifications.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE workspace_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  role text NOT NULL CHECK (role IN ('admin', 'sales', 'designer', 'developer', 'client')),
  password_hash text NOT NULL,
  phone text,
  disabled_at timestamptz,
  disabled_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event text NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Full change history across modules (who changed what, when).
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id, created_at DESC);
CREATE INDEX audit_log_created ON audit_log (created_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'general',
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '' CHECK (link = '' OR link LIKE '/%'),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, kind)
);

-- Outgoing email log; the worker delivers queued rows over SMTP.
CREATE TABLE mail_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address text NOT NULL,
  cc text,
  subject text NOT NULL,
  html text NOT NULL,
  text_body text,
  category text NOT NULL DEFAULT 'transactional',
  related_entity text,
  related_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_outbox_pending ON mail_outbox (send_after) WHERE status = 'queued';

CREATE TABLE worker_runs (
  job text PRIMARY KEY,
  last_run_at timestamptz NOT NULL,
  last_error text
);
