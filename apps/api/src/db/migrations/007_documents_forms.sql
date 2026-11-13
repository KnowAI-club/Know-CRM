-- Proposal / contract / questionnaire documents and public lead forms.

CREATE TABLE document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('proposal', 'contract', 'questionnaire')),
  blocks jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('proposal', 'contract', 'questionnaire')),
  blocks jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  content_hash text,
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'draft' AND content_hash IS NULL AND published_at IS NULL)
      OR (status = 'published' AND content_hash IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX documents_project ON documents (project_id);

-- Published documents are immutable (ON DELETE CASCADE from projects is still allowed via the project trigger bypass).
CREATE FUNCTION immutable_published_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Published documents cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER immutable_published_document BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION immutable_published_document();

-- Client evidence: answers, decisions and typed signatures (append-only).
CREATE TABLE document_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('answered', 'accepted', 'declined', 'signed')),
  block_id text,
  typed_name text,
  answers jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_actions_doc ON document_actions (document_id, created_at);
CREATE UNIQUE INDEX document_actions_decision ON document_actions (document_id, user_id) WHERE action IN ('accepted', 'declined');
CREATE UNIQUE INDEX document_actions_signature ON document_actions (document_id, user_id, block_id) WHERE action = 'signed';

CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Document evidence is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER document_actions_append_only BEFORE UPDATE ON document_actions
  FOR EACH ROW EXECUTE FUNCTION append_only();

CREATE TABLE lead_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  token text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 1,
  published_version integer,
  published_revision integer,
  -- Immutable snapshot served publicly.
  published jsonb,
  archived boolean NOT NULL DEFAULT false,
  owner_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_submissions (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES lead_forms(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_hash text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_submissions_form ON lead_submissions (form_id, created_at DESC);
