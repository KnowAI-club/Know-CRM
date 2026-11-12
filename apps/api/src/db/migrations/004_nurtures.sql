-- Nurture sequences: hand-sent email cadences for parked leads.

CREATE TABLE nurture_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  stop_on_reply boolean NOT NULL DEFAULT true,
  weekly_cap boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nurture_sequence_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES nurture_sequences(id) ON DELETE CASCADE,
  position integer NOT NULL,
  day integer NOT NULL CHECK (day BETWEEN 0 AND 365),
  send_time text NOT NULL DEFAULT '10:30' CHECK (send_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  sender text NOT NULL DEFAULT 'owner' CHECK (sender IN ('owner', 'team', 'person')),
  sender_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  preview text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  signature text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT ''
);
CREATE INDEX nurture_sequence_emails_seq ON nurture_sequence_emails (sequence_id, position);

CREATE TABLE nurture_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES nurture_sequences(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text NOT NULL DEFAULT '',
  paused_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX nurture_assignments_active ON nurture_assignments (lead_id) WHERE status = 'active';

CREATE TABLE nurture_assignment_steps (
  assignment_id uuid NOT NULL REFERENCES nurture_assignments(id) ON DELETE CASCADE,
  email_id uuid NOT NULL REFERENCES nurture_sequence_emails(id) ON DELETE CASCADE,
  sent_at timestamptz,
  replied_at timestamptz,
  marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (assignment_id, email_id)
);

-- Starter sequences (editable).
WITH s AS (
  INSERT INTO nurture_sequences (name, description, position, weekly_cap) VALUES
    ('A · Reconnecting', 'For leads who went quiet after a first conversation.', 0, false),
    ('B · Worth another look', 'For leads who were not ready yet; share fresh ideas.', 1, false),
    ('C · Client stories', 'Long-term nurture with stories from similar clients.', 2, true)
  RETURNING id, position
)
INSERT INTO nurture_sequence_emails (sequence_id, position, day, subject, body)
SELECT s.id, e.pos, e.day, e.subject, e.body FROM s JOIN (VALUES
  (0, 0, 0, 'Picking up where we left off', E'Hi {{first_name}},\n\nWe spoke a while ago about {{problem}}. Is this still something you are working on?\n\nHappy to help if the timing is right.'),
  (0, 1, 3, 'A quick idea for {{company}}', E'Hi {{first_name}},\n\nOne idea that has worked well for teams like yours: start small with the most painful workflow and automate just that.\n\nWorth a short call?'),
  (0, 2, 7, 'Should I close the loop?', E'Hi {{first_name}},\n\nI do not want to fill your inbox. Should I check back in a few months instead?'),
  (1, 0, 1, 'Something new since we spoke', E'Hi {{first_name}},\n\nA lot has changed since we last talked. Here is what we have been building lately.'),
  (1, 1, 8, 'A short case study', E'Hi {{first_name}},\n\nA recent client in {{industry}} cut their manual work in half. Happy to share how.'),
  (2, 0, 0, 'How one team solved {{problem}}', E'Hi {{first_name}},\n\nA short story from a client who faced the same challenge.'),
  (2, 1, 14, 'Another client story', E'Hi {{first_name}},\n\nHere is one more example that may be useful for {{company}}.')
) AS e(seq, pos, day, subject, body) ON e.seq = s.position;
