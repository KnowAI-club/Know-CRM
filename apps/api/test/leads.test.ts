import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAgent, setupSuite } from './helpers.js';

setupSuite();

async function newLead(admin: Awaited<ReturnType<typeof adminAgent>>, email: string) {
  const res = await admin
    .post('/api/leads')
    .send({ name: 'Priya Shah', email, data: { company: 'Shah Labs', source: 'Website', problem: 'Manual reporting' } })
    .expect(201);
  return res.body;
}

test('lead creation enforces unique email and starts in the first open stage', async () => {
  const admin = await adminAgent();
  const lead = await newLead(admin, 'priya@shah.in');
  assert.equal(lead.stage, 'new');
  assert.equal(lead.state, 'active');
  assert.ok(lead.data.ownerId, 'owner defaults to the creator');
  await admin.post('/api/leads').send({ name: 'Dup', email: 'PRIYA@shah.in' }).expect(409);
  await admin.post('/api/leads').send({ name: 'Bad', email: 'bad@x.in', data: { source: 'Nowhere' } }).expect(400);
  const contacts = await admin.get('/api/contacts').expect(200);
  assert.ok(contacts.body.some((c: any) => c.email === 'priya@shah.in'));
});

test('stage moves bump version, set qualified fit and reject stale saves', async () => {
  const admin = await adminAgent();
  const lead = await newLead(admin, 'stage@lead.in');
  const moved = await admin.patch(`/api/leads/${lead.id}`).send({ version: lead.version, stage: 'qualified' }).expect(200);
  assert.equal(moved.body.version, lead.version + 1);
  assert.equal(moved.body.data.qualifiedFit, 'yes');
  await admin.patch(`/api/leads/${lead.id}`).send({ version: lead.version, stage: 'discovery' }).expect(409);
  await admin.patch(`/api/leads/${lead.id}`).send({ version: moved.body.version, stage: 'won' }).expect(409);
  const detail = await admin.get(`/api/leads/${lead.id}`).expect(200);
  assert.equal(detail.body.history[0].action, 'Stage changed');
});

test('exit parks a lead in nurtures and restore returns it to its entry stage', async () => {
  const admin = await adminAgent();
  const lead = await newLead(admin, 'exit@lead.in');
  const moved = await admin.patch(`/api/leads/${lead.id}`).send({ version: lead.version, stage: 'discovery' }).expect(200);
  await admin
    .post(`/api/leads/${lead.id}/action`)
    .send({ action: 'exit', version: moved.body.version, exitStatus: 'on_hold', reason: 'Budget next quarter', tags: ['not_ready'] })
    .expect(400); // on hold needs a resume date
  const parked = await admin
    .post(`/api/leads/${lead.id}/action`)
    .send({
      action: 'exit', version: moved.body.version, exitStatus: 'on_hold', reason: 'Budget next quarter',
      tags: ['not_ready'], resumeDate: '2030-01-15',
    })
    .expect(200);
  assert.equal(parked.body.state, 'nurture');
  assert.equal(parked.body.nurture.status, 'parked');
  assert.equal(parked.body.nurture.entry_stage, 'discovery');
  assert.ok(parked.body.nurture.confirmation_due_at);
  const restored = await admin
    .post(`/api/leads/${lead.id}/action`)
    .send({ action: 'restore', version: parked.body.version })
    .expect(200);
  assert.equal(restored.body.state, 'active');
  assert.equal(restored.body.stage, 'discovery');
  assert.equal(restored.body.exit_status, '');
  assert.equal(restored.body.nurture, null);
});

test('close won creates a project, moves open tasks and freezes the lead', async () => {
  const admin = await adminAgent();
  const lead = await newLead(admin, 'won@lead.in');
  await admin.post(`/api/leads/${lead.id}/tasks`).send({ title: 'Send proposal' }).expect(201);
  await admin
    .post(`/api/leads/${lead.id}/action`)
    .send({ action: 'won', version: lead.version })
    .expect(400); // due date required
  const won = await admin
    .post(`/api/leads/${lead.id}/action`)
    .send({ action: 'won', version: lead.version, dueDate: '2030-06-30', value: 2500000 })
    .expect(200);
  assert.equal(won.body.state, 'won');
  assert.ok(won.body.project_id);
  assert.equal(won.body.project_name, 'Shah Labs - Project');
  const project = await admin.get(`/api/projects/${won.body.project_id}`).expect(200);
  assert.equal(project.body.project.value, 2500000);
  assert.equal(project.body.clientInfo.lead.id, lead.id);
  assert.ok(project.body.tasks.some((t: any) => t.title === 'Send proposal'));
  // Retrying is harmless; further edits are blocked.
  await admin.post(`/api/leads/${lead.id}/action`).send({ action: 'won', version: lead.version, dueDate: '2030-06-30' }).expect(200);
  await admin.patch(`/api/leads/${lead.id}`).send({ version: won.body.version, data: { budget: 'x' } }).expect(409);
  await admin.post(`/api/leads/${lead.id}/notes`).send({ title: 'Handoff note' }).expect(201);
  const cycle = await admin.get(`/api/leads/${lead.id}/cycle`).expect(200);
  assert.ok(cycle.body.segments.length >= 1);
});
