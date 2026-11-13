-- Remove the Nurtures module: parked leads become archived (dropped) leads.

DROP TABLE nurture_assignment_steps, nurture_assignments, nurture_sequence_emails, nurture_sequences, lead_nurture;

UPDATE leads SET state = 'dropped' WHERE state = 'nurture';
ALTER TABLE leads DROP CONSTRAINT leads_state_check;
ALTER TABLE leads ADD CONSTRAINT leads_state_check CHECK (state IN ('active', 'won', 'dropped'));
DROP INDEX leads_open_email;
CREATE UNIQUE INDEX leads_open_email ON leads (lower(email)) WHERE state = 'active';

DELETE FROM tasks WHERE kind IN ('nurture_followup', 'revisit');
ALTER TABLE tasks DROP CONSTRAINT tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('task', 'record_outcome'));

DELETE FROM email_templates WHERE grp = 'NU';
ALTER TABLE email_templates DROP CONSTRAINT email_templates_grp_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_grp_check CHECK (grp = 'EM');

DELETE FROM notifications WHERE kind = 'nurture_review';
DELETE FROM notification_preferences WHERE kind = 'nurture_review';
UPDATE workspace_settings SET data = data - 'nurture';
