-- Clients (contacts), project delivery pipeline, tasks, notes, files, messages and time.

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 500),
  email text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  business_name text NOT NULL DEFAULT '',
  business_email text NOT NULL DEFAULT '',
  personal_email text NOT NULL DEFAULT '',
  poc_name text NOT NULL DEFAULT '',
  poc_role text NOT NULL DEFAULT '',
  poc_email text NOT NULL DEFAULT '',
  poc_phone text NOT NULL DEFAULT '',
  billing_name text NOT NULL DEFAULT '',
  billing_email text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  pan text NOT NULL DEFAULT '',
  alternate_phones text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_email ON contacts (lower(email));
CREATE INDEX contacts_tags ON contacts USING gin (tags);

CREATE TABLE contact_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_comments_contact ON contact_comments (contact_id, created_at DESC);

-- Project board columns. category drives reporting and behaviour.
CREATE TABLE project_stages (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  color text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  category text NOT NULL CHECK (category IN ('inquiry', 'in_progress', 'completed', 'archived')),
  position integer NOT NULL CHECK (position >= 0),
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_stages_position_key UNIQUE (position) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX project_stages_label ON project_stages (lower(label));
INSERT INTO project_stages (id, label, color, category, position, system) VALUES
  ('inquiry', 'Inquiry', '#b7aa97', 'inquiry', 0, true),
  ('in_progress', 'In progress', '#7da397', 'in_progress', 1, true),
  ('completed', 'Completed', '#6b8e78', 'completed', 2, true),
  ('archived', 'Archived', '#a1a1a1', 'archived', 3, true);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 500),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  stage text NOT NULL REFERENCES project_stages(id) ON UPDATE CASCADE,
  value bigint NOT NULL DEFAULT 0 CHECK (value BETWEEN 0 AND 100000000000), -- minor units
  currency char(3) NOT NULL,
  description text NOT NULL DEFAULT '',
  due_date date,
  start_date date,
  owner_id uuid NOT NULL REFERENCES users(id),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  project_type text NOT NULL DEFAULT '',
  lead_source text NOT NULL DEFAULT '',
  archive_reason text NOT NULL DEFAULT '',
  -- 'intake' projects come from public booking/forms and wait for the sales handoff.
  phase text NOT NULL DEFAULT 'delivery' CHECK (phase IN ('intake', 'delivery')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_stage ON projects (stage);
CREATE INDEX projects_contact ON projects (contact_id);

-- Start date is stamped the first time a project enters an in-progress stage and never cleared.
CREATE FUNCTION project_start_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.start_date IS NOT NULL THEN
    NEW.start_date := OLD.start_date;
  ELSIF NEW.start_date IS NULL AND (TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage)
    AND (SELECT category FROM project_stages WHERE id = NEW.stage) = 'in_progress' THEN
    NEW.start_date := CURRENT_DATE;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_start_date BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION project_start_date();

-- Client-visible delivery milestones ("project stages").
CREATE TABLE project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'in_progress', 'done')),
  due_date date,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_milestones_project ON project_milestones (project_id, position);

CREATE FUNCTION project_default_milestones() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_milestones (project_id, title, position)
  SELECT NEW.id, t.title, t.pos - 1
    FROM unnest(ARRAY['Audit', 'Scope Finalised', 'Build', 'First Draft', 'Review and iterations', 'Live', 'Support', 'Closed'])
    WITH ORDINALITY AS t(title, pos);
  RETURN NEW;
END $$;
CREATE TRIGGER project_default_milestones AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION project_default_milestones();

CREATE TABLE project_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number > 0),
  url text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2000),
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  UNIQUE (project_id, number)
);

CREATE TABLE project_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- Client portal grants.
CREATE TABLE project_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- Project timeline.
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description text NOT NULL,
  actor_name text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'client')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_project ON activities (project_id, created_at DESC);
CREATE INDEX activities_created ON activities (created_at DESC);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  visibility text NOT NULL CHECK (visibility IN ('internal', 'client')),
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_project ON notes (project_id, created_at DESC);

-- Project conversation between admins and the client.
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  author_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_project ON messages (project_id, created_at);

CREATE TABLE file_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX file_types_label ON file_types (lower(label));
INSERT INTO file_types (label, position) VALUES ('PRD', 0), ('Invoices', 1), ('Proposal', 2), ('Contract', 3), ('Design', 4);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  size bigint NOT NULL CHECK (size >= 0),
  mime text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'client')),
  to_share boolean NOT NULL DEFAULT false,
  file_type_id uuid REFERENCES file_types(id),
  storage_key text NOT NULL UNIQUE,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_project ON files (project_id);

CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  work_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  description text NOT NULL DEFAULT '',
  billable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_project ON time_entries (project_id, work_date DESC);
