import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { app, adminAgent, setupSuite } from './helpers.js';
import { deliverReminders } from '../src/modules/reminders/service.js';
import { createRecordOutcomeTasks } from '../src/jobs/index.js';
import { query } from '../src/db/pool.js';

setupSuite();

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test('meeting outcome updates the lead and next steps become tasks', async () => {
  const admin = await adminAgent();
  const me = (await admin.get('/api/auth/status')).body.user;
  const lead = (await admin.post('/api/leads').send({ name: 'Meet Lead', email: 'meet@lead.in' }).expect(201)).body;
  const startAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const meeting = (
    await admin
      .post('/api/meetings')
      .send({ title: 'Discovery call', leadId: lead.id, startAt, durationMinutes: 30, notifications: [{ channel: 'in_app', minutes: 60 }] })
      .expect(201)
  ).body;
  const reminders = await admin.get(`/api/reminders?meetingId=${meeting.id}`).expect(200);
  assert.equal(reminders.body.length, 1);
  assert.match(reminders.body[0].title, /starts in 1 hour/);
  await admin.patch(`/api/meetings/${meeting.id}/sharing`).send({ sharing: 'client' }).expect(409);
  await admin.patch(`/api/meetings/${meeting.id}/record`).send({ outcome: 'rescheduled' }).expect(400);
  const record = await admin
    .patch(`/api/meetings/${meeting.id}/record`)
    .send({ outcome: 'attended', summary: 'Good fit', nextSteps: [{ text: 'Send proposal', ownerId: me.id, dueDate: tomorrow() }] })
    .expect(200);
  assert.ok(record.body.nextSteps[0].task_id);
  const detail = await admin.get(`/api/leads/${lead.id}`).expect(200);
  assert.equal(detail.body.lead.data.attendance, 'yes');
  assert.ok(detail.body.history.some((h: any) => h.action === 'Call outcome: Attended'));
  const tasks = await admin.get(`/api/leads/${lead.id}/tasks`).expect(200);
  assert.ok(tasks.body.some((t: any) => t.title === 'Send proposal'));
});

test('ended meetings without an outcome get a record-outcome task', async () => {
  const admin = await adminAgent();
  const lead = (await admin.post('/api/leads').send({ name: 'Past Lead', email: 'past@lead.in' }).expect(201)).body;
  const m = (
    await admin
      .post('/api/meetings')
      .send({ title: 'Old call', leadId: lead.id, startAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30 })
      .expect(201)
  ).body;
  await query(`UPDATE meetings SET start_at = now() - interval '2 hours' WHERE id=$1`, [m.id]);
  await createRecordOutcomeTasks();
  await createRecordOutcomeTasks();
  const tasks = await admin.get(`/api/leads/${lead.id}/tasks`).expect(200);
  assert.equal(tasks.body.filter((t: any) => t.kind === 'record_outcome').length, 1);
});

test('reminders are delivered in-app and are idempotent per client id', async () => {
  const admin = await adminAgent();
  const me = (await admin.get('/api/auth/status')).body.user;
  const lead = (await admin.post('/api/leads').send({ name: 'Rem Lead', email: 'rem@lead.in' }).expect(201)).body;
  const id = randomUUID();
  const body = { id, leadId: lead.id, recipientId: me.id, title: 'Call back', runAt: new Date(Date.now() + 1000).toISOString() };
  await admin.post('/api/reminders').send(body).expect(201);
  await admin.post('/api/reminders').send(body).expect(200);
  await admin.post('/api/reminders').send({ ...body, title: 'Other' }).expect(409);
  await query(`UPDATE reminders SET run_at = now() - interval '1 minute' WHERE id=$1`, [id]);
  await deliverReminders();
  const list = await admin.get(`/api/reminders?leadId=${lead.id}`).expect(200);
  assert.equal(list.body[0].status, 'sent');
  const notes = await admin.get('/api/notifications').expect(200);
  assert.ok(JSON.stringify(notes.body).includes('Call back'));
});

test('public booking reserves a slot, creates CRM records and can be cancelled', async () => {
  const admin = await adminAgent();
  const type = (
    await admin
      .post('/api/booking/types')
      .send({
        title: 'Intro call', timezone: 'UTC', duration: 30, minimumNotice: 0, horizon: 30,
        availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '12:00' })),
      })
      .expect(201)
  ).body;
  const pub = request(app);
  await pub.get(`/api/public/booking/${type.token}`).expect(200);
  const slots = (await pub.get(`/api/public/booking/${type.token}/slots?date=${tomorrow()}`).expect(200)).body;
  assert.equal(slots.length, 11); // 09:00–11:30 every 15 minutes
  assert.equal(slots[0].startAt, `${tomorrow()}T09:00:00.000Z`);
  const secret = randomBytes(32).toString('hex');
  const reserve = { requestId: randomUUID(), managementSecret: secret, name: 'Guest One', email: 'guest@one.in', startAt: slots[0].startAt };
  const first = await pub.post(`/api/public/booking/${type.token}/reservations`).send(reserve).expect(201);
  assert.equal(first.body.managementPath, `/book/manage/${secret}`);
  await pub.post(`/api/public/booking/${type.token}/reservations`).send(reserve).expect(200);
  await pub
    .post(`/api/public/booking/${type.token}/reservations`)
    .send({ ...reserve, requestId: randomUUID(), managementSecret: randomBytes(32).toString('hex') })
    .expect(409);
  await pub.post(`/api/public/booking/${type.token}/reservations`).send({ ...reserve, requestId: randomUUID(), website: 'spam' }).expect(400);
  const after = (await pub.get(`/api/public/booking/${type.token}/slots?date=${tomorrow()}`).expect(200)).body;
  assert.equal(after.length, 9); // 09:00 and 09:15 now overlap the booking

  const leads = (await admin.get('/api/leads').expect(200)).body;
  const lead = leads.find((l: any) => l.email === 'guest@one.in');
  assert.equal(lead.data.source, 'Booking');
  const meetings = (await admin.get('/api/meetings').expect(200)).body;
  const meeting = meetings.find((m: any) => m.source === 'booking');
  assert.equal(meeting.lead_id, lead.id);

  await pub.post(`/api/public/booking/manage/${secret}/reschedule`).send({ startAt: slots[4].startAt }).expect(200);
  const moved = (await admin.get(`/api/meetings/${meeting.id}`).expect(200)).body.meeting;
  assert.equal(new Date(moved.start_at).toISOString(), slots[4].startAt);
  await pub.post(`/api/public/booking/manage/${secret}/cancel`).send({}).expect(200);
  const cancelled = (await admin.get(`/api/meetings/${meeting.id}`).expect(200)).body.meeting;
  assert.equal(cancelled.status, 'cancelled');
});
