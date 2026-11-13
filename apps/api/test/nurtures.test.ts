import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAgent, setupSuite } from './helpers.js';
import { dueAt, plan } from '../src/modules/nurtures/schedule.js';

setupSuite();

test('schedule: due times follow India time and the weekly cap', () => {
  const start = new Date('2026-03-02T05:00:00Z'); // 10:30 IST, Monday
  assert.equal(dueAt(start, 0, '10:30').toISOString(), '2026-03-02T05:00:00.000Z');
  assert.equal(dueAt(start, 3, '09:00').toISOString(), '2026-03-05T03:30:00.000Z');
  const emails = [
    { id: 'a', position: 0, day: 0, send_time: '10:30', subject: 'One' },
    { id: 'b', position: 1, day: 2, send_time: '10:30', subject: 'Two' },
  ];
  const capped = plan({ started_at: start }, { weekly_cap: true, stop_on_reply: true }, emails, [], new Date('2026-03-02T06:00:00Z'));
  assert.equal(capped[0]!.status, 'due');
  assert.equal(capped[1]!.due_at, '2026-03-09T05:00:00.000Z');
  assert.equal(capped[1]!.status, 'upcoming');
  const replied = plan({ started_at: start }, { weekly_cap: false, stop_on_reply: true }, emails, [
    { email_id: 'a', sent_at: start, replied_at: start },
  ]);
  assert.deepEqual(
    replied.map((c) => c.status),
    ['replied', 'paused'],
  );
});

test('nurture import, sequence assignment, marking emails and discard', async () => {
  const admin = await adminAgent();
  const imported = await admin
    .post('/api/nurtures/leads')
    .send({
      source: 'imported',
      leads: [
        { name: 'Kiran', company: 'K Co', email: 'kiran@k.co' },
        { name: 'Kiran again', email: 'KIRAN@k.co' },
      ],
    })
    .expect(201);
  assert.equal(imported.body.added, 1);
  assert.equal(imported.body.skipped[0].reason, 'Listed twice');
  const leadId = imported.body.ids[0];

  const general = await admin.get('/api/nurtures/general').expect(200);
  assert.ok(general.body.leads.some((l: any) => l.id === leadId));
  const seq = await admin
    .post('/api/nurtures/sequences')
    .send({
      name: 'Test seq',
      status: 'active',
      weeklyCap: false,
      emails: [
        { day: 0, sendTime: '10:00', subject: 'Hi {{first_name}}', body: 'Hello' },
        { day: 3, sendTime: '10:00', subject: 'Again', body: 'Hello again' },
      ],
    })
    .expect(201);
  await admin
    .post('/api/nurtures/sequences')
    .send({
      name: 'Bad',
      emails: [
        { day: 3, sendTime: '10:00', subject: 'x', body: 'y' },
        { day: 1, sendTime: '10:00', subject: 'x', body: 'y' },
      ],
    })
    .expect(400);

  const assigned = await admin.post('/api/nurtures/assignments').send({ leadId, sequenceId: seq.body.id }).expect(201);
  await admin.post('/api/nurtures/assignments').send({ leadId, sequenceId: seq.body.id }).expect(409);
  const assignmentId = assigned.body.id;
  const [first] = seq.body.emails;
  await admin.post(`/api/nurtures/assignments/${assignmentId}/emails/${first}`).send({ replied: true }).expect(409);
  await admin.post(`/api/nurtures/assignments/${assignmentId}/emails/${first}`).send({ sent: true }).expect(200);
  const marked = await admin.post(`/api/nurtures/assignments/${assignmentId}/emails/${first}`).send({ replied: true }).expect(200);
  assert.equal(marked.body.next.kind, 'reply');

  const counts = await admin.get('/api/nurtures/counts').expect(200);
  assert.equal(counts.body.tracking, 1);
  await admin.delete(`/api/nurtures/sequences/${seq.body.id}`).expect(409);

  await admin.post(`/api/nurtures/leads/${leadId}/discard`).send({ reason: 'Replied, not interested' }).expect(200);
  const discard = await admin.get('/api/nurtures/discard').expect(200);
  assert.equal(discard.body.rows.length, 1);
  await admin.post(`/api/nurtures/leads/${leadId}/restore`).send({}).expect(200);
  const after = await admin.get('/api/nurtures/general').expect(200);
  assert.equal(after.body.leads.find((l: any) => l.id === leadId).source, 'replied');
});
